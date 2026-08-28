const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { openDatabase } = require('../database');
const { createStripeBilling } = require('../stripe-billing');
const { season, registrationQuote, origin, allowMoney, safeStripeUrl } = require('../billing-config');
const { fakeStripe } = require('./fake-stripe');

function fixture(t) {
  let time = Date.parse('2026-09-10T10:00:00Z'); const clock = () => time;
  const env = { BASE_URL: 'http://127.0.0.1:3000', STRIPE_SECRET_KEY: 'sk_test_fake_for_isolated_tests', STRIPE_MODE: 'test',
    SEASON_ID: '2026-2027', STRIPE_EXPECTED_MONTHLY_CENTS: '5000', STRIPE_REGISTRATION_FEE_CENTS: '5000', STRIPE_SUBSCRIPTION_PRICE_ID: 'price_monthly',
    BILLING_POLICY: 'calendar_full_months_day8', PAYMENT_TERMS_VERSION: 'test-v2', PAYMENT_TERMS_APPROVED: 'true', AUTH_SECRET: 'only-a-test-secret-'.repeat(5), STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test', STRIPE_WEBHOOK_SECRET: 'whsec_fake' };
  const db = openDatabase(':memory:'); const fake = fakeStripe(clock);
  const billing = createStripeBilling({ db, env, clock, stripe: fake.api, sendMail: async () => {} }); t.after(() => { billing.stopWorker(); db.close(); });
  const registration = { nome_ragazzo: 'Atleta Prova', nome_genitore: 'Genitore Prova', email: 'genitore@example.test', telefono: '3331234567', pacchetto: 'primi-calci', data_nascita: '2018-03-02' };
  async function start(overrides = {}) { return billing.start({ context: 'registration', registration, account: { email: registration.email }, requestKey: randomUUID(), accepted: true, consentVersion: registrationQuote(season(env, clock), clock).consentVersion, ...overrides }); }
  function sessionFor(result) { return db.prepare('SELECT external_id FROM payment_orders WHERE id=?').get(result.orderId).external_id; }
  return { db, env, fake, billing, registration, start, sessionFor, clock, setTime: value => { time = value; } };
}
test('configuration refuses missing dates and unapproved billing policy', () => {
  assert.throws(() => season({}));
  assert.throws(() => season({ SEASON_ID: 'test', SEASON_END_AT: '2027-02-30T00:00:00Z' }));
  assert.throws(() => season({ SEASON_ID: 'test', SEASON_END_AT: '2027-06-30T00:00:00Z', BILLING_POLICY: 'invented' }));
});
test('new seasonal checkout offers card and PayPal in one session with identical amounts and dates', async t => {
  const f = fixture(t); const requestKey = randomUUID();
  const result = await f.start({ requestKey });
  const session = f.fake.state.sessions.get(f.sessionFor(result));
  assert.deepEqual(session.payment_method_types, ['card', 'paypal']);
  assert.equal(session.amount_total, 10000); assert.equal(session.payment_method_collection, 'always');
  assert.equal(session.subscription_data.trial_end, Date.parse('2026-10-08T08:00:00Z') / 1000);
  assert.equal((await f.start({ requestKey })).orderId, result.orderId); assert.equal(f.fake.state.creates, 1);
});
test('May also offers PayPal and card without starting a subscription', async t => {
  const f = fixture(t); f.setTime(Date.parse('2027-05-20T12:00:00Z'));
  const result = await f.start(); const session = f.fake.state.sessions.get(f.sessionFor(result));
  assert.deepEqual(session.payment_method_types, ['card', 'paypal']);
  assert.equal(session.mode, 'payment'); assert.equal(session.amount_total, 10000);
});
test('August Sandbox checkout requires email and consent, records preview, then reconciles season end once', async t => {
  const f = fixture(t); f.setTime(Date.parse('2026-08-28T12:00:00Z'));
  Object.assign(f.env, { SANDBOX_EARLY_REGISTRATION: 'true', LIVE_PAYMENTS_ENABLED: 'false' });
  await assert.rejects(f.start({ account: null }), /email/);
  await assert.rejects(f.start({ accepted: false }), /condizioni/);
  assert.equal(f.fake.state.creates, 0);
  const result = await f.start(); const sessionId = f.sessionFor(result);
  const pending = f.fake.state.sessions.get(sessionId);
  assert.equal(pending.expires_at, Math.floor(f.clock() / 1000) + 3600);
  assert.match(pending.custom_text.submit.message, /SOLO TEST/);
  assert.equal(JSON.parse(f.db.prepare('SELECT payload FROM payment_orders').get().payload).payment_consent.sandbox_calendar_preview, true);
  // An abandoned/failed provider authentication is not a successful payment.
  await f.billing.complete(pending);
  assert.equal(f.db.prepare('SELECT status FROM payment_orders').get().status, 'PENDING');
  const paid = f.fake.paid(sessionId); await f.billing.complete(paid); await f.billing.complete(paid);
  assert.equal(f.db.prepare('SELECT status FROM payment_orders').get().status, 'PAID');
  assert.equal(f.fake.state.subs.get(paid.subscription).cancel_at, Date.parse('2027-06-08T08:00:00Z') / 1000);
  assert.equal(f.fake.state.subs.size, 1);
});
test('early test flag blocks live payments even with all other live approvals', () => {
  assert.throws(() => allowMoney({ SANDBOX_EARLY_REGISTRATION: 'true', STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_fake',
    LIVE_PAYMENTS_ENABLED: 'true', BASE_URL: 'https://example.test', PAYMENTS_STORAGE_CONFIRMED: 'true',
    PAYMENTS_DB_PATH: '/var/data/payments.db', STRIPE_WEBHOOK_SECRET: 'whsec_fake', STRIPE_RECEIPTS_CONFIGURED: 'true' }), /prova anticipata/);
});
test('return origin and Stripe URLs reject credential, protocol and suffix attacks', () => {
  assert.throws(() => origin({ BASE_URL: 'https://example.test/path' }));
  assert.throws(() => origin({ BASE_URL: 'http://example.test' }));
  for (const url of ['javascript:alert(1)', 'https://stripe.com.attacker.test', 'https://evilstripe.com', 'https://a:b@stripe.com']) assert.equal(safeStripeUrl(url), null);
  assert.equal(safeStripeUrl('https://pay.stripe.com/receipt/test'), 'https://pay.stripe.com/receipt/test');
});
test('live payments fail closed without activation, HTTPS and persistent storage', () => {
  assert.throws(() => allowMoney({ STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_fake' }));
  assert.throws(() => allowMoney({ STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_live_fake' }));
  assert.throws(() => allowMoney({ STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_fake', LIVE_PAYMENTS_ENABLED: 'true', BASE_URL: 'https://example.test', PAYMENTS_DB_PATH: './payments.db' }));
});
test('verified account and explicit current consent are required', async t => {
  const f = fixture(t);
  await assert.rejects(f.start({ account: { email: 'other@example.test' } }), /email/);
  await assert.rejects(f.start({ accepted: false }), /condizioni/);
  await assert.rejects(f.start({ consentVersion: 'outdated' }), /condizioni/);
  assert.equal(f.fake.state.creates, 0);
});
test('invalid date of birth cannot create a subscription', async t => {
  const f = fixture(t); await assert.rejects(f.start({ registration: { ...f.registration, data_nascita: '2018-02-30' } }), /nascita/); assert.equal(f.fake.state.creates, 0);
});
test('price must be monthly, fixed, active, in EUR and equal approved amount', async t => {
  const f = fixture(t); const retrieve = f.fake.api.prices.retrieve;
  for (const change of [{ unit_amount: 5100 }, { currency: 'usd' }, { active: false }, { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } }, { livemode: true }]) {
    f.fake.api.prices.retrieve = async () => ({ ...await retrieve(), ...change }); await assert.rejects(f.start());
  }
  assert.equal(f.fake.state.creates, 0);
});
test('checkout order and consent are persisted before contacting Stripe', async t => {
  const f = fixture(t); const create = f.fake.api.checkout.sessions.create;
  f.fake.api.checkout.sessions.create = async (params, options) => {
    const order = f.db.prepare('SELECT * FROM payment_orders WHERE id=?').get(params.client_reference_id);
    assert.ok(order); assert.equal(JSON.parse(order.payload).payment_consent.policy, 'calendar_full_months_day8');
    assert.ok(f.db.prepare('SELECT 1 FROM rv_orders WHERE order_id=?').get(order.id));
    return create(params, options);
  };
  await f.start();
});
test('concurrent duplicate submission creates exactly one Checkout', async t => {
  const f = fixture(t); const requestKey = randomUUID();
  const results = await Promise.all([f.start({ requestKey }), f.start({ requestKey }), f.start({ requestKey })]);
  assert.equal(new Set(results.map(r => r.orderId)).size, 1); assert.equal(f.fake.state.creates, 1);
});
test('new request key for the same pending athlete reuses the original Checkout', async t => {
  const f = fixture(t); assert.equal((await f.start()).orderId, (await f.start()).orderId); assert.equal(f.fake.state.creates, 1);
});
test('unknown network outcome retries with the same Stripe idempotency key', async t => {
  const f = fixture(t); f.fake.state.failCreateOnce = true; const key = randomUUID();
  await assert.rejects(f.start({ requestKey: key }), /Timeout/); const result = await f.start({ requestKey: key });
  assert.ok(result.url); assert.equal(f.fake.state.creates, 1);
});
test('request key cannot be reused with different content or by another user', async t => {
  const f = fixture(t); const key = randomUUID(); await f.start({ requestKey: key });
  await assert.rejects(f.start({ requestKey: key, registration: { ...f.registration, nome_ragazzo: 'Altro Atleta' } }), /cambiati/);
  await assert.rejects(f.start({ requestKey: key, account: { email: 'other@example.test' }, registration: { ...f.registration, email: 'other@example.test' } }), /disponibile/);
});
test('two children share the verified parent customer but have distinct subscriptions', async t => {
  const f = fixture(t); const one = await f.start(); const two = await f.start({ registration: { ...f.registration, nome_ragazzo: 'Secondo Atleta', data_nascita: '2019-03-02' } });
  assert.notEqual(one.orderId, two.orderId); assert.equal(f.fake.state.customers.size, 1); assert.equal(f.fake.state.creates, 2);
});
test('successful payment applies and verifies the season end', async t => {
  const f = fixture(t); const result = await f.start(); const session = f.fake.paid(f.sessionFor(result));
  await f.billing.complete(session);
  assert.equal(f.fake.state.subs.get(session.subscription).cancel_at, season(f.env, f.clock).end);
  assert.equal(f.db.prepare('SELECT done FROM rv_jobs').get().done, 1);
  assert.equal(f.db.prepare('SELECT status FROM payment_orders WHERE id=?').get(result.orderId).status, 'PAID');
});
test('paid athlete cannot inadvertently subscribe again in the same season', async t => {
  const f = fixture(t); const result = await f.start(); await f.billing.complete(f.fake.paid(f.sessionFor(result)));
  await assert.rejects(f.start(), /già un’iscrizione/); assert.equal(f.fake.state.creates, 1);
});
test('completed checkout with changed owner or amount cannot confirm the order', async t => {
  const f = fixture(t); const result = await f.start(); const session = f.fake.paid(f.sessionFor(result));
  await assert.rejects(f.billing.complete({ ...session, amount_total: 1 }), /Mismatch/);
  await assert.rejects(f.billing.complete({ ...session, customer: 'cus_other' }), /Mismatch/);
  assert.equal(f.db.prepare('SELECT status FROM payment_orders WHERE id=?').get(result.orderId).status, 'PENDING');
});
test('unpaid Checkout never becomes a confirmed order', async t => {
  const f = fixture(t); const result = await f.start(); const session = await f.fake.api.checkout.sessions.retrieve(f.sessionFor(result));
  await f.billing.complete(session); assert.equal(f.db.prepare('SELECT status FROM payment_orders').get().status, 'PENDING');
});
test('expired Checkout releases only its own athlete claim for a new attempt', async t => {
  const f = fixture(t); const result = await f.start(); f.fake.state.sessions.get(f.sessionFor(result)).status = 'expired';
  const second = await f.start(); assert.notEqual(second.orderId, result.orderId); assert.equal(f.fake.state.creates, 2);
});
test('failure to configure the season remains visible and is retried', async t => {
  const f = fixture(t); const result = await f.start(); const session = f.fake.paid(f.sessionFor(result)); f.fake.state.failUpdate = true;
  await assert.rejects(f.billing.complete(session), /Unavailable/);
  assert.equal(f.db.prepare('SELECT done FROM rv_jobs').get().done, 0); assert.equal(f.db.prepare('SELECT status FROM payment_orders').get().status, 'PAID');
  f.fake.state.failUpdate = false; await f.billing.reconcile(); assert.equal(f.db.prepare('SELECT done FROM rv_jobs').get().done, 1);
});
test('reconciler recovers payment when webhook and return page are missing', async t => {
  const f = fixture(t); const result = await f.start(); f.fake.paid(f.sessionFor(result)); await f.billing.reconcile();
  assert.equal(f.db.prepare('SELECT status FROM payment_orders').get().status, 'PAID'); assert.equal(f.db.prepare('SELECT done FROM rv_jobs').get().done, 1);
});
test('duplicate webhook is processed once, and stale events cannot reactivate a canceled subscription', async t => {
  const f = fixture(t); const result = await f.start(); const session = f.fake.paid(f.sessionFor(result));
  const event = { id: 'evt_same', type: 'checkout.session.completed', livemode: false, data: { object: session } };
  await Promise.all([f.billing.processEvent(event), f.billing.processEvent(event)]);
  assert.equal(f.db.prepare('SELECT attempts FROM rv_events WHERE id=?').get(event.id).attempts, 1);
  f.fake.state.subs.get(session.subscription).status = 'canceled';
  await f.billing.processEvent({ id: 'evt_old', type: 'invoice.payment_succeeded', livemode: false, data: { object: { subscription: session.subscription } } });
  assert.equal(f.db.prepare('SELECT status FROM subscriptions').get().status, 'CANCELED');
});
test('an earlier customer cancellation is never extended to the season end', async t => {
  const f = fixture(t); const result = await f.start(); const session = f.fake.paid(f.sessionFor(result));
  const earlier = Math.floor(f.clock() / 1000) + 86400; f.fake.state.subs.get(session.subscription).cancel_at = earlier;
  await f.billing.complete(session); assert.equal(f.fake.state.subs.get(session.subscription).cancel_at, earlier); assert.equal(f.fake.state.updates.length, 0);
});
test('void pause is displayed separately and never removed by season reconciliation', async t => {
  const f = fixture(t); const result = await f.start(); const session = f.fake.paid(f.sessionFor(result));
  f.fake.state.subs.get(session.subscription).pause_collection = { behavior: 'void', resumes_at: Math.floor(f.clock() / 1000) + 86400 * 30 };
  await f.billing.complete(session);
  const view = f.billing.subscriptionView(f.fake.state.subs.get(session.subscription)); assert.equal(view.status, 'SUSPENDED'); assert.equal(view.pauseBehavior, 'void');
  assert.ok(f.fake.state.subs.get(session.subscription).pause_collection);
});
test('overdue safety cancellation does not generate an invoice or proration', async t => {
  const f = fixture(t); const result = await f.start(); const session = f.fake.paid(f.sessionFor(result)); f.fake.state.failUpdate = true;
  await assert.rejects(f.billing.complete(session)); f.fake.state.failUpdate = false; f.setTime(Date.parse('2027-07-01T12:00:00Z'));
  await f.billing.ensureEnd(session.subscription); assert.deepEqual(f.fake.state.canceled[0], { key: session.subscription, invoice_now: false, prorate: false });
});
test('unrelated account events do not create an order or mutate a subscription', async t => {
  const f = fixture(t); f.fake.state.subs.set('sub_unrelated', { id: 'sub_unrelated', livemode: false, customer: 'cus_unused', status: 'active', metadata: {} });
  await f.billing.processEvent({ id: 'evt_unrelated', type: 'customer.subscription.created', livemode: false, data: { object: { id: 'sub_unrelated' } } });
  assert.equal(f.db.prepare('SELECT count(*) n FROM rv_jobs').get().n, 0); assert.equal(f.fake.state.updates.length, 0);
});
test('legacy subscription without a new-season snapshot is preserved, not bulk changed', async t => {
  const f = fixture(t); const now = new Date(f.clock()).toISOString();
  f.db.prepare('INSERT INTO payment_orders VALUES (?,\'stripe\',\'registration\',\'PAID\',?,NULL,NULL,?)').run('legacy', JSON.stringify(f.registration), now);
  f.fake.state.subs.set('sub_legacy', { id: 'sub_legacy', customer: 'cus_legacy', livemode: false, status: 'active', metadata: { local_order_id: 'legacy' } });
  await f.billing.processEvent({ id: 'evt_legacy', type: 'customer.subscription.updated', livemode: false, data: { object: { id: 'sub_legacy' } } });
  assert.equal(f.db.prepare('SELECT count(*) n FROM rv_jobs').get().n, 0); assert.equal(f.fake.state.updates.length, 0);
});
test('reconciliation recovers a paid session after unknown create outcome and absent webhook', async t => {
  const f = fixture(t); f.fake.state.failCreateOnce = true;
  await assert.rejects(f.start());
  const id = [...f.fake.state.sessions.keys()][0]; f.fake.paid(id);
  assert.equal(f.db.prepare('SELECT external_id FROM payment_orders').get().external_id, null);
  await f.billing.reconcile();
  assert.equal(f.db.prepare('SELECT status FROM payment_orders').get().status, 'PAID');
  assert.equal(f.db.prepare('SELECT done FROM rv_jobs').get().done, 1);
  assert.equal(f.fake.state.creates, 1);
});
test('reconciliation repairs crash between recording payment and queuing the season end', async t => {
  const f = fixture(t); const result = await f.start(); f.fake.paid(f.sessionFor(result));
  f.db.prepare("UPDATE payment_orders SET status='PAID'").run();
  await f.billing.reconcile(); assert.equal(f.db.prepare('SELECT done FROM rv_jobs').get().done, 1);
});
test('September 20 Checkout charges exactly 100 now and defers only the recurring line', async t => {
  const f = fixture(t); f.setTime(Date.parse('2026-09-20T12:00:00+02:00'));
  const result = await f.start(); const session = f.fake.state.sessions.get(f.sessionFor(result));
  assert.equal(session.amount_total, 10000); assert.equal(session.line_items.length, 3);
  assert.deepEqual(session.line_items.filter(i => i.price_data).map(i => i.price_data.unit_amount), [5000, 5000]);
  assert.equal(session.subscription_data.trial_end, Date.parse('2026-10-08T08:00:00Z') / 1000);
  assert.equal(session.payment_method_collection, 'always');
  assert.equal(session.subscription_data.trial_settings.end_behavior.missing_payment_method, 'cancel');
  assert.equal(session.payment_intent_data, undefined);
  await f.billing.complete(f.fake.paid(session.id));
  assert.equal(f.db.prepare('SELECT paid_amount FROM rv_orders').get().paid_amount, 10000);
  assert.equal(f.fake.state.subs.get(f.fake.state.sessions.get(session.id).subscription).cancel_at, Date.parse('2027-06-08T08:00:00Z') / 1000);
});
test('May entry is confirmed as a one-time 100 payment without creating a subscription or retry job', async t => {
  const f = fixture(t); f.setTime(Date.parse('2027-05-20T12:00:00+02:00'));
  const result = await f.start(); const session = f.fake.paid(f.sessionFor(result));
  assert.equal(session.mode, 'payment'); assert.equal(session.subscription_data, undefined); assert.equal(session.amount_total, 10000);
  await f.billing.complete(session); await f.billing.reconcile();
  assert.equal(f.db.prepare('SELECT status FROM payment_orders').get().status, 'PAID');
  assert.equal(f.db.prepare('SELECT count(*) n FROM rv_jobs').get().n, 0); assert.equal(f.fake.state.subs.size, 0);
  assert.equal((await f.billing.reconcile()).checked, 0);
  await assert.rejects(f.start(), /già un’iscrizione/);
});
test('May cannot be falsely confirmed as subscription mode or with an unexpected subscription', async t => {
  const f = fixture(t); f.setTime(Date.parse('2027-05-20T12:00:00+02:00'));
  const result = await f.start(); const session = f.fake.paid(f.sessionFor(result));
  await assert.rejects(f.billing.complete({ ...session, mode: 'subscription' }), /ModeMismatch/);
  await assert.rejects(f.billing.complete({ ...session, subscription: 'sub_wrong' }), /UnexpectedSubscription/);
  assert.equal(f.db.prepare('SELECT status FROM payment_orders').get().status, 'PENDING');
});
test('a paid Checkout cannot attach a subscription owned by another family', async t => {
  const f = fixture(t); const result = await f.start(); const session = f.fake.paid(f.sessionFor(result));
  f.fake.state.subs.get(session.subscription).customer = 'cus_other';
  await assert.rejects(f.billing.complete(session), /SubscriptionOrderMismatch/);
  assert.equal(f.db.prepare('SELECT status FROM payment_orders').get().status, 'PENDING');
});
test('client-supplied amounts cannot change the registration fee or current month', async t => {
  const f = fixture(t); const result = await f.start({ registration: { ...f.registration, amount: 1, registrationAmount: 1, dueNow: 1 } });
  assert.equal(f.fake.state.sessions.get(f.sessionFor(result)).amount_total, 10000);
});
test('checkout expires before calendar month rollover and late attempts fail without external creation', async t => {
  const f = fixture(t); f.setTime(Date.parse('2026-09-30T23:00:00+02:00'));
  const result = await f.start(); const session = f.fake.state.sessions.get(f.sessionFor(result));
  assert.equal(session.expires_at, Date.parse('2026-09-30T23:59:00+02:00') / 1000);
  f.setTime(Date.parse('2026-09-30T23:40:00+02:00'));
  await assert.rejects(f.start({ registration: { ...f.registration, nome_ragazzo: 'Altro atleta' } }), /mese sta cambiando/);
  assert.equal(f.fake.state.creates, 1);
});
test('stale month consent cannot initiate a different month payment', async t => {
  const f = fixture(t); const consentVersion = registrationQuote(season(f.env, f.clock), f.clock).consentVersion;
  f.setTime(Date.parse('2026-10-01T12:00:00+02:00'));
  await assert.rejects(f.start({ consentVersion }), /condizioni/); assert.equal(f.fake.state.creates, 0);
});
test('a previous season snapshot keeps its original end; new policy does not migrate old orders', async t => {
  const f = fixture(t); const result = await f.start(); const session = f.fake.paid(f.sessionFor(result));
  const row = f.db.prepare('SELECT season_json FROM rv_orders').get(); const snapshot = JSON.parse(row.season_json);
  snapshot.policy = 'anniversary_prorated_end'; snapshot.end = Date.parse('2027-06-30T21:59:59Z') / 1000;
  f.db.prepare('UPDATE rv_orders SET season_json=?').run(JSON.stringify(snapshot));
  await f.billing.complete(session); assert.equal(f.fake.state.subs.get(session.subscription).cancel_at, snapshot.end);
});
test('server rejects August enrollment before any customer or Checkout creation, even with stale consent and old flag', async t => {
  const f = fixture(t); const consentVersion = registrationQuote(season(f.env, f.clock), f.clock).consentVersion;
  f.setTime(Date.parse('2026-08-28T12:00:00+02:00')); f.env.PRESEASON_REGISTRATION_ENABLED = 'true';
  await assert.rejects(f.billing.start({ context: 'registration', registration: f.registration,
    account: { email: f.registration.email }, requestKey: randomUUID(), accepted: true, consentVersion }),
  error => error.status === 409 && /aprono il 1° settembre 2026/.test(error.message));
  assert.equal(f.fake.state.creates, 0); assert.equal(f.fake.state.customers.size, 0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM payment_orders').get().n, 0);
});
