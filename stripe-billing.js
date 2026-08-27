const Stripe = require('stripe');
const { randomUUID } = require('node:crypto');
const { transaction } = require('./database');
const { createAccountAuth } = require('./account-auth');
const { PublicError, digest, emailKey, objectId, origin, mode, allowMoney, season, safeStripeUrl, route } = require('./billing-config');

function createStripeBilling({ db, env = process.env, clock = Date.now, stripe: injectedStripe, sendMail } = {}) {
  const auth = createAccountAuth({ db, env, clock, sendMail });
  const seconds = () => Math.floor(clock() / 1000);
  const iso = () => new Date(clock()).toISOString();
  let client; const locks = new Map();
  function stripe() {
    mode(env);
    return injectedStripe || (client ||= new Stripe(env.STRIPE_SECRET_KEY, { timeout: 15000, maxNetworkRetries: 2 }));
  }
  async function locked(key, action) {
    const previous = locks.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(action);
    locks.set(key, task);
    try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
  }
  function checkMode(object) {
    if (typeof object.livemode !== 'boolean' || object.livemode !== (mode(env) === 'live'))
      throw new PublicError('Risorsa Stripe di un ambiente diverso. Operazione bloccata.', 409);
  }
  async function priceConfig() {
    const settings = season(env, clock);
    if (!env.STRIPE_SUBSCRIPTION_PRICE_ID) throw new PublicError('Prezzo mensile Stripe non configurato.', 503);
    const price = await stripe().prices.retrieve(env.STRIPE_SUBSCRIPTION_PRICE_ID, { expand: ['product'] });
    checkMode(price);
    if (!price.active || price.product?.active === false || price.currency !== 'eur' || price.unit_amount !== settings.amount ||
        price.billing_scheme !== 'per_unit' || price.recurring?.interval !== 'month' || price.recurring?.interval_count !== 1 ||
        price.recurring?.usage_type !== 'licensed') throw new PublicError('Il prezzo Stripe non corrisponde alla quota mensile approvata. Contatta la segreteria.', 503);
    return { ...settings, priceId: price.id };
  }
  async function ownedCustomer(email, id) {
    if (!/^cus_[a-zA-Z0-9]+$/.test(id || '')) throw new PublicError('Cliente non disponibile.', 404);
    const customer = await stripe().customers.retrieve(id);
    if (customer.deleted || emailKey(customer.email) !== emailKey(email)) throw new PublicError('Cliente non disponibile.', 404);
    checkMode(customer); return customer;
  }
  async function customers(email) {
    const found = new Map();
    let after; let pages = 0;
    do {
      const page = await stripe().customers.list({ email, limit: 100, ...(after ? { starting_after: after } : {}) });
      for (const c of page.data) if (!c.deleted && emailKey(c.email) === email) { checkMode(c); found.set(c.id, c); }
      after = page.has_more ? page.data.at(-1)?.id : null;
      if (++pages >= 10 && after) throw new PublicError('Troppi profili storici: chiedi alla segreteria la verifica dell’archivio.', 409);
    } while (after);
    // Also recover older customer profiles whose email differed only in case.
    const legacy = db.prepare("SELECT DISTINCT external_id FROM subscriptions WHERE provider='stripe' AND lower(email)=?").all(email);
    for (const row of legacy) {
      const sub = await stripe().subscriptions.retrieve(row.external_id, { expand: ['customer'] });
      const c = typeof sub.customer === 'object' ? sub.customer : await stripe().customers.retrieve(sub.customer);
      if (!c.deleted && emailKey(c.email) === email) { checkMode(c); found.set(c.id, c); }
    }
    const mapped = db.prepare('SELECT stripe_id FROM rv_customers WHERE email=?').get(email);
    if (mapped?.stripe_id && !found.has(mapped.stripe_id)) {
      const c = await ownedCustomer(email, mapped.stripe_id); found.set(c.id, c);
    }
    return [...found.values()];
  }
  async function customerForCheckout(email, name) {
    return locked('customer:' + email, async () => {
      let row = db.prepare('SELECT * FROM rv_customers WHERE email=?').get(email);
      if (row?.stripe_id) return (await ownedCustomer(email, row.stripe_id)).id;
      const existing = await customers(email);
      if (existing.length) {
        db.prepare('INSERT INTO rv_customers VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET stripe_id=excluded.stripe_id').run(email, existing[0].id, seconds());
        return existing[0].id;
      }
      if (row && seconds() - row.created_at > 23 * 3600) throw new PublicError('Creazione cliente da verificare con la segreteria. Nessun nuovo pagamento avviato.', 409);
      if (!row) { db.prepare('INSERT INTO rv_customers VALUES (?,NULL,?)').run(email, seconds()); row = { created_at: seconds() }; }
      const c = await stripe().customers.create({ email, name, preferred_locales: ['it'], metadata: { rv_app: 'realvilla' } }, { idempotencyKey: 'rv-customer-' + digest(email) });
      checkMode(c);
      db.prepare('UPDATE rv_customers SET stripe_id=? WHERE email=?').run(c.id, email); return c.id;
    });
  }
  async function resumeAttempt(row, fingerprint) {
    if (row.fingerprint !== fingerprint) throw new PublicError('I dati di questo tentativo sono cambiati. Controlla prima I miei pagamenti.', 409);
    const order = db.prepare('SELECT * FROM payment_orders WHERE id=?').get(row.order_id);
    if (order.external_id) {
      const session = await stripe().checkout.sessions.retrieve(order.external_id);
      checkMode(session);
      if (session.status === 'complete' || session.payment_status === 'paid')
        return { url: origin(env) + '/stripe/complete?session_id=' + encodeURIComponent(session.id), orderId: order.id };
      if (session.status === 'expired') throw new PublicError('Il tentativo è scaduto. Ricarica la pagina per un nuovo tentativo.', 410);
      const url = safeStripeUrl(session.url);
      if (!url) throw new PublicError('Sessione non disponibile. Contatta la segreteria.', 409);
      return { url, orderId: order.id };
    }
    if (seconds() - row.created_at > 23 * 3600 || seconds() >= row.expires_at - 1800)
      throw new PublicError('Tentativo da verificare: non avviare un secondo pagamento. Contatta la segreteria.', 409);
    const session = await stripe().checkout.sessions.create(JSON.parse(row.checkout_params), { idempotencyKey: 'rv-checkout-' + order.id });
    checkMode(session);
    const url = safeStripeUrl(session.url);
    if (!url) throw new Error('InvalidCheckoutURL');
    transaction(db, () => {
      db.prepare('UPDATE payment_orders SET external_id=? WHERE id=?').run(session.id, order.id);
      db.prepare('UPDATE rv_orders SET session_url=? WHERE order_id=?').run(url, order.id);
    });
    return { url, orderId: order.id };
  }
  async function start({ context, registration, items, customer, requestKey, account, accepted, consentVersion }) {
    allowMoney(env);
    if (!auth.available()) throw new PublicError('Accesso email non configurato.', 503);
    if (!account?.email) throw new PublicError('Verifica prima la tua email.', 401);
    if (!/^[0-9a-f-]{36}$/i.test(requestKey || '')) throw new PublicError('Identificativo del tentativo mancante. Ricarica la pagina.');
    const payload = context === 'registration' ? { ...registration } : { items, customer: { ...customer } };
    const email = emailKey(context === 'registration' ? registration.email : customer.email);
    if (email !== account.email) throw new PublicError('Usa l’email che hai verificato per accedere.', 403);
    let settings = null; let enrollmentKey = null;
    if (context === 'registration') {
      settings = await priceConfig();
      if (accepted !== true || consentVersion !== settings.consentVersion) throw new PublicError('Leggi e accetta le condizioni aggiornate prima di procedere.', 409);
      const birth = String(registration.data_nascita || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || !Number.isFinite(Date.parse(birth)) || new Date(birth).toISOString().slice(0, 10) !== birth || Date.parse(birth) > clock() || birth < '1900-01-01') throw new PublicError('Data di nascita non valida.');
      enrollmentKey = digest([email, registration.nome_ragazzo.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' '), birth, settings.id].join('|'));
    }
    const fingerprint = digest(JSON.stringify({ context, payload, season: settings?.consentVersion || null }));
    return locked('checkout:' + email, async () => {
      auth.limit('checkout:' + email, 20, 900);
      const previous = db.prepare('SELECT * FROM rv_orders WHERE request_key=?').get(requestKey);
      if (previous) {
        if (previous.email !== email) throw new PublicError('Tentativo non disponibile.', 403);
        return resumeAttempt(previous, fingerprint);
      }
      if (enrollmentKey) {
        const held = db.prepare('SELECT o.* FROM rv_orders o JOIN rv_enrollments e ON e.order_id=o.order_id WHERE e.key=?').get(enrollmentKey);
        if (held) {
          const order = db.prepare('SELECT * FROM payment_orders WHERE id=?').get(held.order_id);
          if (order.external_id) {
            const session = await stripe().checkout.sessions.retrieve(order.external_id);
            if (session.status === 'expired' && session.payment_status !== 'paid') {
              db.prepare('DELETE FROM rv_enrollments WHERE key=? AND order_id=?').run(enrollmentKey, held.order_id);
            } else if (session.status === 'open' && held.fingerprint === fingerprint) return resumeAttempt(held, fingerprint);
            else throw new PublicError('Esiste già un’iscrizione o un pagamento da verificare per questo atleta e questa stagione. Apri I miei pagamenti.', 409);
          } else return resumeAttempt(held, fingerprint);
        }
      }
      const customerId = await customerForCheckout(email, context === 'registration' ? registration.nome_genitore : customer.nome);
      const id = 'RV' + randomUUID().replaceAll('-', '');
      const expiry = Math.min(seconds() + 3600, settings?.end || Infinity);
      if (expiry < seconds() + 1800) throw new PublicError('Le iscrizioni per questa stagione sono chiuse.', 409);
      const amount = context === 'registration' ? settings.amount : items.reduce((n, item) => n + item.price * item.quantity, 0);
      const metadata = { local_order_id: id, context, rv_app: 'realvilla' };
      const params = {
        mode: context === 'registration' ? 'subscription' : 'payment', locale: 'it', customer: customerId,
        client_reference_id: id, metadata, expires_at: expiry, payment_method_types: ['card'],
        success_url: origin(env) + '/stripe/complete?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: origin(env) + (context === 'registration' ? '/cancel.html' : '/shop-cancel.html'),
        allow_promotion_codes: false,
        line_items: context === 'registration' ? [{ price: settings.priceId, quantity: 1 }] : items.map(item => ({ quantity: item.quantity, price_data: { currency: 'eur', unit_amount: item.price, product_data: { name: item.name, description: 'Taglia: ' + item.size } } })),
      };
      if (settings) {
        params.subscription_data = { metadata: { ...metadata, rv_season_end: String(settings.end), rv_season: settings.id } };
        params.custom_text = { submit: { message: `Quota mensile con rinnovo nel giorno dell’iscrizione. Fine stagione: ${new Date(settings.end * 1000).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}. Ultimo periodo eventualmente proporzionale. Esenzioni solo previa approvazione della società.` } };
        payload.payment_consent = { version: settings.consentVersion, terms: settings.version, accepted_at: iso(), policy: settings.policy, season_end: settings.end, monthly_cents: settings.amount };
      } else params.payment_intent_data = { receipt_email: email, metadata };
      transaction(db, () => {
        db.prepare('INSERT INTO payment_orders(id,provider,context,status,payload,created_at) VALUES (?,\'stripe\',?,\'PENDING\',?,?)').run(id, context, JSON.stringify(payload), iso());
        db.prepare(`INSERT INTO rv_orders(order_id,request_key,email,fingerprint,enrollment_key,expected_amount,customer_id,season_json,checkout_params,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, requestKey, email, fingerprint, enrollmentKey, amount, customerId, settings ? JSON.stringify(settings) : null, JSON.stringify(params), expiry, seconds());
        if (enrollmentKey) db.prepare('INSERT INTO rv_enrollments VALUES (?,?)').run(enrollmentKey, id);
      });
      return resumeAttempt(db.prepare('SELECT * FROM rv_orders WHERE order_id=?').get(id), fingerprint);
    });
  }
  function state(sub) {
    if (sub.status === 'canceled') return 'CANCELED';
    if (sub.status === 'incomplete_expired') return 'EXPIRED';
    if (sub.pause_collection || sub.status === 'paused') return 'SUSPENDED';
    return ['active', 'trialing'].includes(sub.status) ? 'ACTIVE' : 'PAYMENT_FAILED';
  }
  async function syncSubscription(sub) {
    checkMode(sub);
    const localId = sub.metadata?.local_order_id;
    const order = localId ? db.prepare("SELECT * FROM payment_orders WHERE id=? AND provider='stripe' AND context='registration'").get(localId) : null;
    const old = db.prepare("SELECT * FROM subscriptions WHERE provider='stripe' AND external_id=?").get(sub.id);
    if (!order && !old) return;
    const customerId = objectId(sub.customer);
    const registration = order ? JSON.parse(order.payload) : {};
    const settings = order ? db.prepare('SELECT season_json FROM rv_orders WHERE order_id=?').get(order.id) : null;
    const seasonEnd = settings?.season_json ? JSON.parse(settings.season_json).end : null;
    const ends = sub.items?.data?.map(i => i.current_period_end).filter(Number.isFinite) || [];
    const periodEnd = ends.length ? Math.min(...ends) : sub.current_period_end;
    transaction(db, () => {
      if (old) db.prepare('UPDATE subscriptions SET status=?,next_charge_at=?,contract_id=COALESCE(contract_id,?) WHERE provider=\'stripe\' AND external_id=?')
        .run(state(sub), periodEnd ? new Date(periodEnd * 1000).toISOString() : null, order?.id || null, sub.id);
      else db.prepare('INSERT INTO subscriptions(id,provider,email,status,external_id,contract_id,next_charge_at,created_at) VALUES (?,\'stripe\',?,?,?,?,?,?)')
        .run(randomUUID(), emailKey(registration.email), state(sub), sub.id, order.id, periodEnd ? new Date(periodEnd * 1000).toISOString() : null, iso());
      db.prepare(`INSERT INTO rv_subscriptions VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(stripe_id) DO UPDATE SET customer_id=excluded.customer_id, order_id=COALESCE(excluded.order_id,rv_subscriptions.order_id), season_end=COALESCE(excluded.season_end,rv_subscriptions.season_end), cancel_at=excluded.cancel_at, pause_json=excluded.pause_json, stripe_status=excluded.stripe_status, updated_at=excluded.updated_at`)
        .run(sub.id, customerId, order?.id || old?.contract_id || null, seasonEnd, sub.cancel_at || null, sub.pause_collection ? JSON.stringify(sub.pause_collection) : null, sub.status, seconds());
      if (seasonEnd) db.prepare('INSERT INTO rv_jobs(subscription_id,order_id,season_end) VALUES (?,?,?) ON CONFLICT(subscription_id) DO NOTHING').run(sub.id, order.id, seasonEnd);
    });
  }
  async function ensureEnd(subscriptionId) {
    return locked('sub:' + subscriptionId, async () => {
      const job = db.prepare('SELECT * FROM rv_jobs WHERE subscription_id=?').get(subscriptionId);
      if (!job) return;
      let sub = await stripe().subscriptions.retrieve(subscriptionId);
      checkMode(sub);
      const terminal = ['canceled', 'incomplete_expired'].includes(sub.status);
      const effectiveEnd = sub.cancel_at || (sub.cancel_at_period_end ? periodEnd(sub) : null);
      if (!terminal && (!effectiveEnd || effectiveEnd > job.season_end)) {
        allowMoney(env);
        if (job.season_end <= seconds()) {
          // An overdue safety task never creates charges or prorations.
          sub = await stripe().subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
        } else {
          sub = await stripe().subscriptions.update(subscriptionId, { cancel_at: job.season_end, proration_behavior: 'none' });
        }
      }
      const actualEnd = sub.cancel_at || (sub.cancel_at_period_end ? periodEnd(sub) : null);
      if (!['canceled', 'incomplete_expired'].includes(sub.status) && (!actualEnd || actualEnd > job.season_end)) throw new Error('SeasonEndNotApplied');
      await syncSubscription(sub);
      db.prepare('UPDATE rv_jobs SET done=1,error_code=NULL WHERE subscription_id=?').run(subscriptionId);
    });
  }
  async function complete(session) {
    checkMode(session);
    const id = session.metadata?.local_order_id || session.client_reference_id;
    const order = id ? db.prepare("SELECT * FROM payment_orders WHERE id=? AND provider='stripe'").get(id) : db.prepare("SELECT * FROM payment_orders WHERE external_id=? AND provider='stripe'").get(session.id);
    if (!order) return null; // Other products may share the Stripe account.
    if (order.external_id && order.external_id !== session.id) throw new Error('SessionOrderMismatch');
    if (session.status !== 'complete' || session.payment_status !== 'paid') return order;
    const local = db.prepare('SELECT * FROM rv_orders WHERE order_id=?').get(order.id);
    if (local && (session.amount_total !== local.expected_amount || session.currency !== local.currency || objectId(session.customer) !== local.customer_id)) throw new Error('CheckoutAmountOrOwnerMismatch');
    if (order.context === 'registration' && session.mode !== 'subscription') throw new Error('CheckoutModeMismatch');
    if (order.context === 'shop' && session.mode !== 'payment') throw new Error('CheckoutModeMismatch');
    transaction(db, () => {
      db.prepare("UPDATE payment_orders SET status='PAID',external_id=? WHERE id=?").run(session.id, order.id);
      if (local) db.prepare('UPDATE rv_orders SET paid_amount=? WHERE order_id=?').run(session.amount_total, order.id);
    });
    if (order.context === 'registration') {
      const subscriptionId = objectId(session.subscription);
      if (!subscriptionId) throw new Error('SubscriptionMissing');
      await locked('sub:' + subscriptionId, async () => syncSubscription(await stripe().subscriptions.retrieve(subscriptionId)));
      await ensureEnd(subscriptionId);
    }
    return db.prepare('SELECT * FROM payment_orders WHERE id=?').get(order.id);
  }
  const handled = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed', 'invoice.voided', 'charge.refunded']);
  async function processEvent(event) {
    checkMode(event);
    if (!handled.has(event.type)) return;
    return locked('event:' + event.id, async () => {
      const old = db.prepare('SELECT processed FROM rv_events WHERE id=?').get(event.id);
      if (old?.processed) return;
      db.prepare('INSERT INTO rv_events(id,type,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').run(event.id, event.type, seconds());
      db.prepare('UPDATE rv_events SET attempts=attempts+1 WHERE id=?').run(event.id);
      try {
        const object = event.data.object;
        if (event.type.startsWith('checkout.session.')) {
          // Retrieve current state instead of trusting event ordering.
          const latest = await stripe().checkout.sessions.retrieve(object.id);
          await complete(latest);
          if (latest.status === 'expired') db.prepare("UPDATE payment_orders SET status='EXPIRED' WHERE provider='stripe' AND external_id=? AND status='PENDING'").run(latest.id);
        } else {
          const subId = event.type.startsWith('customer.subscription.') ? object.id : objectId(object.subscription) || objectId(object.parent?.subscription_details?.subscription);
          if (subId) {
            await locked('sub:' + subId, async () => syncSubscription(await stripe().subscriptions.retrieve(subId)));
            await ensureEnd(subId);
          }
        }
        db.prepare('UPDATE rv_events SET processed=1,error_code=NULL WHERE id=?').run(event.id);
      } catch (error) {
        db.prepare('UPDATE rv_events SET error_code=? WHERE id=?').run(error.code || error.name, event.id); throw error;
      }
    });
  }
  function installWebhook(app) {
    app.post('/stripe/webhook', require('express').raw({ type: 'application/json', limit: '300kb' }), async (req, res) => {
      if (!env.STRIPE_WEBHOOK_SECRET) return res.sendStatus(503);
      let event;
      try { event = stripe().webhooks.constructEvent(req.body, req.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET); }
      catch { return res.sendStatus(400); }
      try { await processEvent(event); res.sendStatus(200); }
      catch (error) { console.error('Evento Stripe da riprovare:', event.id, error.code || error.name); res.sendStatus(503); }
    });
  }
  function periodEnd(sub) {
    const ends = sub.items?.data?.map(i => i.current_period_end).filter(Number.isFinite) || [];
    return ends.length ? Math.min(...ends) : sub.current_period_end || null;
  }
  function subscriptionView(sub) {
    const local = db.prepare('SELECT * FROM rv_subscriptions WHERE stripe_id=?').get(sub.id);
    const order = local?.order_id ? db.prepare('SELECT payload FROM payment_orders WHERE id=?').get(local.order_id) : null;
    const payload = order ? JSON.parse(order.payload) : {};
    const end = sub.cancel_at || (sub.cancel_at_period_end ? periodEnd(sub) : null);
    const pause = sub.pause_collection;
    return { id: sub.id, athlete: payload.nome_ragazzo || 'Iscrizione sportiva', status: state(sub), stripeStatus: sub.status,
      periodEnd: periodEnd(sub), cancelAt: end, seasonEnd: local?.season_end || null,
      paused: !!pause, resumesAt: pause?.resumes_at || null, pauseBehavior: pause?.behavior || null,
      amount: sub.items?.data?.[0]?.price?.unit_amount ?? null, currency: sub.currency || 'eur',
      version: digest(JSON.stringify([sub.id, sub.status, end, periodEnd(sub), pause || null])),
      setupPending: !!db.prepare('SELECT 1 FROM rv_jobs WHERE subscription_id=? AND done=0').get(sub.id),
    };
  }
  async function subscriptionsForCustomer(customerId) {
    const all = []; let after;
    do {
      const page = await stripe().subscriptions.list({ customer: customerId, status: 'all', limit: 100, ...(after ? { starting_after: after } : {}) });
      all.push(...page.data); after = page.has_more ? page.data.at(-1)?.id : null;
      if (all.length >= 1000 && after) throw new PublicError('Archivio molto esteso: contatta la segreteria.', 409);
    } while (after);
    return all;
  }
  function installRoutes(app) {
    auth.install(app);
    app.get('/api/payments/providers', (req, res) => {
      res.set('Cache-Control', 'no-store');
      let stripeReady = false;
      try { allowMoney(env); stripeReady = auth.available(); } catch {}
      res.json({ stripe: stripeReady, paypal: env.PAYPAL_CHECKOUT_ENABLED === 'true' && !!env.PAYPAL_CLIENT_ID && !!env.PAYPAL_CLIENT_SECRET && auth.available() });
    });
    app.get('/api/billing/config', route(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const settings = await priceConfig(); allowMoney(env);
      res.json({ ...settings, testMode: mode(env) === 'test', accessAvailable: auth.available() });
    }));
    app.get('/api/account/overview', auth.required, route(async (req, res) => {
      auth.limit('overview:' + req.account.email, 40, 900);
      const profiles = await customers(req.account.email); const result = [];
      for (const c of profiles) result.push({ id: c.id, subscriptions: (await subscriptionsForCustomer(c.id)).map(subscriptionView) });
      res.json({ profiles: result, testMode: mode(env) === 'test' });
    }));
    app.get('/api/account/history', auth.required, route(async (req, res) => {
      auth.limit('history:' + req.account.email, 60, 900);
      const id = String(req.query.customer || ''); await ownedCustomer(req.account.email, id);
      const after = String(req.query.after || '');
      if (after && !/^ch_[a-zA-Z0-9]+$/.test(after)) throw new PublicError('Pagina non valida.');
      const page = await stripe().charges.list({ customer: id, limit: 25, ...(after ? { starting_after: after } : {}) });
      res.json({ payments: page.data.map(charge => ({ id: charge.id, created: charge.created, amount: charge.amount, currency: charge.currency, status: charge.status,
        refunded: charge.amount_refunded || 0, receipt: safeStripeUrl(charge.receipt_url) })), next: page.has_more ? page.data.at(-1)?.id : null });
    }));
    app.post('/api/account/portal', auth.sameOrigin, auth.required, route(async (req, res) => {
      allowMoney(env); auth.limit('portal:' + req.account.email, 20, 900);
      const id = String(req.body.customer || ''); await ownedCustomer(req.account.email, id);
      if (!env.STRIPE_PORTAL_CONFIGURATION_ID) throw new PublicError('Portale Stripe non ancora configurato. Contatta la segreteria.', 503);
      const config = await stripe().billingPortal.configurations.retrieve(env.STRIPE_PORTAL_CONFIGURATION_ID);
      if (!config.active || config.features?.subscription_update?.enabled || config.features?.subscription_cancel?.enabled ||
          !config.features?.invoice_history?.enabled || !config.features?.payment_method_update?.enabled)
        throw new PublicError('La configurazione del portale deve essere verificata dalla segreteria.', 503);
      const session = await stripe().billingPortal.sessions.create({ customer: id, configuration: config.id, return_url: origin(env) + '/i-miei-pagamenti.html' });
      const url = safeStripeUrl(session.url); if (!url) throw new Error('InvalidPortalURL'); res.json({ url });
    }));
    app.post('/api/account/subscriptions/:id/cancel', auth.sameOrigin, auth.required, route(async (req, res) => {
      allowMoney(env); auth.limit('cancel:' + req.account.email, 10, 900);
      const id = String(req.params.id);
      if (!/^sub_[a-zA-Z0-9]+$/.test(id)) throw new PublicError('Abbonamento non disponibile.', 404);
      await locked('sub:' + id, async () => {
        const sub = await stripe().subscriptions.retrieve(id); await ownedCustomer(req.account.email, objectId(sub.customer)); checkMode(sub);
        const view = subscriptionView(sub);
        if (req.body.confirm !== true || req.body.version !== view.version) throw new PublicError('I dati sono cambiati: aggiorna la pagina e verifica nuovamente la data di disdetta.', 409);
        if (['canceled', 'incomplete_expired'].includes(sub.status)) return res.json({ subscription: view });
        if (!view.periodEnd) throw new PublicError('Scadenza da verificare con la segreteria.', 409);
        const cancelAt = Math.min(view.periodEnd, view.cancelAt || Infinity, view.seasonEnd || Infinity);
        if (cancelAt <= seconds()) throw new PublicError('Scadenza in corso di elaborazione. Contatta la segreteria.', 409);
        const updated = await stripe().subscriptions.update(id, { cancel_at: cancelAt, proration_behavior: 'none' });
        await syncSubscription(updated);
        db.prepare('INSERT INTO rv_audit(actor,action,target,created_at) VALUES (?,\'cancel_at_period_end\',?,?)').run(req.account.email, id, seconds());
        res.json({ subscription: subscriptionView(updated) });
      });
    }));
    app.get('/api/account/orders', auth.required, route(async (req, res) => {
      const rows = db.prepare(`SELECT p.* FROM payment_orders p WHERE lower(COALESCE(json_extract(p.payload,'$.email'),json_extract(p.payload,'$.customer.email')))=? ORDER BY created_at DESC LIMIT 101`).all(req.account.email);
      res.json({ orders: rows.slice(0, 100).map(o => ({ id: o.id, context: o.context, provider: o.provider, status: o.status, createdAt: o.created_at })), truncated: rows.length > 100 });
    }));
    app.get('/api/account/orders/:id/receipt', auth.required, route(async (req, res) => {
      const order = db.prepare("SELECT * FROM payment_orders WHERE id=? AND provider='stripe'").get(req.params.id);
      if (!order?.external_id) throw new PublicError('Ricevuta non disponibile.', 404);
      const payload = JSON.parse(order.payload);
      if (emailKey(payload.email || payload.customer?.email) !== req.account.email) throw new PublicError('Ricevuta non disponibile.', 404);
      const session = await stripe().checkout.sessions.retrieve(order.external_id, { expand: ['payment_intent.latest_charge', 'invoice'] }); checkMode(session);
      const stripeEmail = emailKey(session.customer_details?.email || session.customer_email);
      if (session.customer) await ownedCustomer(req.account.email, objectId(session.customer));
      else if (stripeEmail !== req.account.email) throw new PublicError('Ricevuta non disponibile.', 404);
      if (session.payment_status !== 'paid') throw new PublicError('Il pagamento non risulta completato.', 409);
      const url = safeStripeUrl(session.payment_intent?.latest_charge?.receipt_url || session.invoice?.hosted_invoice_url);
      if (!url) throw new PublicError('Ricevuta in preparazione. Riprova più tardi.', 409);
      res.json({ url });
    }));
    app.get('/api/admin/overview', auth.required, auth.admin, route(async (req, res) => {
      res.set('Cache-Control', 'no-store'); auth.limit('admin:' + req.account.email, 30, 900);
      const after = String(req.query.after || '');
      if (after && !/^sub_[a-zA-Z0-9]+$/.test(after)) throw new PublicError('Pagina non valida.');
      const page = await stripe().subscriptions.list({ status: 'all', limit: 25, ...(after ? { starting_after: after } : {}) });
      res.json({ subscriptions: page.data.map(s => ({ ...subscriptionView(s), dashboard: `https://dashboard.stripe.com/${mode(env) === 'test' ? 'test/' : ''}subscriptions/${s.id}` })),
        next: page.has_more ? page.data.at(-1)?.id : null,
        pendingTasks: db.prepare('SELECT count(*) AS n FROM rv_jobs WHERE done=0').get().n,
        failedEvents: db.prepare('SELECT count(*) AS n FROM rv_events WHERE processed=0').get().n,
        testMode: mode(env) === 'test' });
    }));
    app.post('/api/subscriptions/cancel', (req, res) => res.status(410).json({ error: 'La vecchia disdetta via email e telefono è stata disabilitata. Accedi a I miei pagamenti; per PayPal gestisci i pagamenti automatici dal tuo account PayPal.' }));
  }
  async function reconcile() {
    if (!env.STRIPE_SECRET_KEY) return { checked: 0, failed: 0 };
    const jobs = db.prepare('SELECT * FROM rv_jobs WHERE done=0 AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 25').all(seconds());
    let failed = 0;
    for (const job of jobs) {
      try { await ensureEnd(job.subscription_id); }
      catch (error) {
        failed++;
        db.prepare('UPDATE rv_jobs SET attempts=attempts+1,next_attempt_at=?,error_code=? WHERE subscription_id=?')
          .run(seconds() + Math.min(3600, 30 * 2 ** Math.min(job.attempts, 7)), error.code || error.name, job.subscription_id);
      }
    }
    // Recover a completed Checkout even when its webhook or browser return was lost.
    const pending = db.prepare(`SELECT p.id,p.external_id,r.customer_id,r.created_at FROM payment_orders p JOIN rv_orders r ON r.order_id=p.id
      LEFT JOIN rv_reconcile_checks c ON c.order_id=p.id
      WHERE p.provider='stripe' AND (p.status='PENDING' OR (p.status='PAID' AND p.context='registration' AND NOT EXISTS(SELECT 1 FROM rv_jobs j WHERE j.order_id=p.id)))
      ORDER BY COALESCE(c.checked_at,0),r.created_at LIMIT 25`).all();
    for (const p of pending) {
      try {
        db.prepare('INSERT INTO rv_reconcile_checks VALUES (?,?) ON CONFLICT(order_id) DO UPDATE SET checked_at=excluded.checked_at').run(p.id, seconds());
        let session;
        if (p.external_id) session = await stripe().checkout.sessions.retrieve(p.external_id);
        else {
          // Resolve an unknown network outcome by looking up the original session,
          // never by blindly creating a second Checkout after the 24h key window.
          let after; let pages = 0;
          do {
            const page = await stripe().checkout.sessions.list({ customer: p.customer_id, created: { gte: p.created_at - 60 }, limit: 100, ...(after ? { starting_after: after } : {}) });
            const matches = page.data.filter(s => s.client_reference_id === p.id);
            if (matches.length > 1) throw new Error('AmbiguousCheckout');
            if (matches.length) { session = matches[0]; break; }
            after = page.has_more ? page.data.at(-1)?.id : null;
          } while (after && ++pages < 5);
          if (!session) continue;
          checkMode(session);
          db.prepare('UPDATE payment_orders SET external_id=? WHERE id=? AND external_id IS NULL').run(session.id, p.id);
        }
        await complete(session);
        if (session.status === 'expired') db.prepare("UPDATE payment_orders SET status='EXPIRED' WHERE external_id=? AND status='PENDING'").run(session.id);
      } catch { failed++; }
    }
    auth.cleanup(); return { checked: jobs.length + pending.length, failed };
  }
  let timer; let running = false;
  function startWorker() {
    if (timer) return;
    const run = async () => { if (running) return; running = true; try { const result = await reconcile(); if (result.failed) console.error('Pagamenti: operazioni da verificare in segreteria:', result.failed); } catch { console.error('Controllo pagamenti non disponibile'); } finally { running = false; } };
    timer = setInterval(run, 60000); timer.unref(); run();
  }
  function stopWorker() { if (timer) clearInterval(timer); timer = null; }
  return { auth, start, complete, processEvent, installWebhook, installRoutes, reconcile, startWorker, stopWorker, stripe, priceConfig, ensureEnd, subscriptionView, customers };
}
module.exports = { createStripeBilling };
