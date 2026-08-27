const { randomUUID } = require("node:crypto");
const { openDatabase } = require("./database");
const { createStripeBilling } = require("./stripe-billing");
const { origin, emailKey } = require("./billing-config");
const baseUrl = origin();
const db = openDatabase();
const billing = createStripeBilling({ db });

const products = {
  "kit-gara": {
    name: "Kit gara Real Villa",
    price: 6500,
    sizes: ["XS", "S", "M", "L", "XL", "XXL"],
  },
  "kit-allenamento": {
    name: "Kit allenamento Real Villa",
    price: 5500,
    sizes: ["XS", "S", "M", "L", "XL", "XXL"],
  },
  zaino: { name: "Zaino Real Villa", price: 3500, sizes: ["Taglia unica"] },
  calzini: {
    name: "Calzini Real Villa",
    price: 1200,
    sizes: ["31-34", "35-38", "39-42", "43-46"],
  },
};

const now = () => new Date().toISOString();
const shortId = (prefix) => prefix + randomUUID().replaceAll("-", "");

function validateRegistration(data) {
  const fields = [
    "nome_ragazzo",
    "nome_genitore",
    "email",
    "telefono",
    "pacchetto",
    "data_nascita",
  ];
  if (!data || fields.some((field) => !String(data[field] || "").trim()))
    throw new Error("Compila tutti i dati dell’iscrizione");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
    throw new Error("Indirizzo email non valido");
  if (!["piccoli-campioni", "primi-calci", "dal-2017"].includes(data.pacchetto))
    throw new Error("Categoria non valida");
  return Object.fromEntries(
    fields.map((field) => [field, field === "email" ? emailKey(data[field]) : String(data[field]).trim().slice(0, 200)]),
  );
}

function validateCart(items) {
  if (!Array.isArray(items) || !items.length || items.length > 20)
    throw new Error("Carrello non valido");
  return items.map((item) => {
    const product = products[item.id];
    const quantity = Number(item.quantity);
    const size = String(item.size || "");
    if (
      !product ||
      !product.sizes.includes(size) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 10
    )
      throw new Error("Uno dei prodotti non è valido");
    return {
      id: item.id,
      name: product.name,
      price: product.price,
      size,
      quantity,
    };
  });
}

function validateShopCustomer(data) {
  const fields = ["nome", "email", "telefono"];
  if (!data || fields.some((field) => !String(data[field] || "").trim()))
    throw new Error("Compila i dati di contatto per l’ordine");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
    throw new Error("Indirizzo email non valido");
  const telefono = String(data.telefono).replace(/\D/g, "");
  if (telefono.length < 8 || telefono.length > 15)
    throw new Error("Numero di telefono non valido");
  return {
    nome: String(data.nome).trim().slice(0, 120),
    email: String(data.email).trim().toLowerCase().slice(0, 200),
    telefono: String(data.telefono).trim().slice(0, 40),
    note: String(data.note || "").trim().slice(0, 300),
  };
}

function saveOrder(order) {
  db.prepare(
    "INSERT INTO payment_orders (id,provider,context,status,payload,external_id,contract_id,created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    order.id,
    order.provider,
    order.context,
    order.status,
    JSON.stringify(order.payload),
    order.externalId || null,
    order.contractId || null,
    now(),
  );
}

function updateOrder(id, status, externalId = null) {
  db.prepare(
    "UPDATE payment_orders SET status=?, external_id=COALESCE(?,external_id) WHERE id=?",
  ).run(status, externalId, id);
}

function saveSubscription({ provider, email, externalId, contractId }) {
  const existing = db
    .prepare("SELECT id FROM subscriptions WHERE provider=? AND external_id=?")
    .get(provider, externalId);
  if (existing) {
    db.prepare(
      "UPDATE subscriptions SET email=?, status='ACTIVE', contract_id=COALESCE(?,contract_id), next_charge_at=NULL WHERE id=?",
    ).run(email.toLowerCase(), contractId || null, existing.id);
    return;
  }
  db.prepare(
    "INSERT INTO subscriptions (id,provider,email,status,external_id,contract_id,next_charge_at,created_at) VALUES (?,?,?,?,?,?,NULL,?)",
  ).run(
    randomUUID(),
    provider,
    email.toLowerCase(),
    "ACTIVE",
    externalId,
    contractId || null,
    now(),
  );
}

function updateSubscriptionStatus(provider, externalId, status) {
  if (!externalId) return;
  db.prepare(
    "UPDATE subscriptions SET status=? WHERE provider=? AND external_id=?",
  ).run(status, provider, externalId);
}

const paypalBase = () =>
  process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

async function paypalToken() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET)
    throw new Error("Credenziali PayPal non configurate");
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");
  const response = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok)
    throw new Error(
      data.error_description || "Autenticazione PayPal non riuscita",
    );
  return data.access_token;
}

async function paypalRequest(endpoint, options = {}) {
  const token = await paypalToken();
  const response = await fetch(`${paypalBase()}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok)
    throw new Error(
      data.message ||
        data.error_description ||
        "Operazione PayPal non riuscita",
    );
  return data;
}

async function startPayPalShop(items, customer) {
  const id = shortId("PPS");
  const total = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const order = await paypalRequest("/v2/checkout/orders", {
    method: "POST",
    headers: { "PayPal-Request-Id": id },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: id,
          custom_id: id,
          description: `Ordine shop di ${customer.nome}`,
          amount: {
            currency_code: "EUR",
            value: (total / 100).toFixed(2),
            breakdown: {
              item_total: {
                currency_code: "EUR",
                value: (total / 100).toFixed(2),
              },
            },
          },
          items: items.map((item) => ({
            name: item.name,
            description: `Taglia: ${item.size}`,
            quantity: String(item.quantity),
            unit_amount: {
              currency_code: "EUR",
              value: (item.price / 100).toFixed(2),
            },
          })),
        },
      ],
      application_context: {
        brand_name: "ASD Real Villa",
        user_action: "PAY_NOW",
        return_url: `${baseUrl}/paypal/shop/complete`,
        cancel_url: `${baseUrl}/shop-cancel.html`,
      },
    }),
  });
  saveOrder({
    id,
    provider: "paypal",
    context: "shop",
    status: "PENDING",
    payload: { items, customer },
    externalId: order.id,
  });
  return order.links.find((link) => link.rel === "approve")?.href;
}

async function startPayPalRegistration(registration) {
  if (!process.env.PAYPAL_SUBSCRIPTION_PLAN_ID)
    throw new Error("Piano PayPal mensile non configurato");
  const id = shortId("PPR");
  const subscription = await paypalRequest("/v1/billing/subscriptions", {
    method: "POST",
    headers: { "PayPal-Request-Id": id },
    body: JSON.stringify({
      plan_id: process.env.PAYPAL_SUBSCRIPTION_PLAN_ID,
      custom_id: id,
      subscriber: {
        name: { given_name: registration.nome_genitore },
        email_address: registration.email,
      },
      application_context: {
        brand_name: "ASD Real Villa",
        user_action: "SUBSCRIBE_NOW",
        return_url: `${baseUrl}/paypal/subscription/complete?local=${id}`,
        cancel_url: `${baseUrl}/cancel.html`,
      },
    }),
  });
  saveOrder({
    id,
    provider: "paypal",
    context: "registration",
    status: "PENDING",
    payload: registration,
    externalId: subscription.id,
  });
  return subscription.links.find((link) => link.rel === "approve")?.href;
}

function installStripeWebhookRoute(app) { billing.installWebhook(app); }

function getOrderPublicSummary(order) {
  const payload = JSON.parse(order.payload);
  const items =
    order.context === "shop"
      ? Array.isArray(payload)
        ? payload
        : payload.items || []
      : [];
  const detail = db.prepare("SELECT paid_amount,expected_amount FROM rv_orders WHERE order_id=?").get(order.id);
  const amount = detail?.paid_amount ?? detail?.expected_amount ?? (
    order.context === "registration"
      ? 5000
      : items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  return {
    id: order.id,
    context: order.context,
    provider: order.provider,
    status: order.status,
    confirmed: order.status === "PAID",
    setupPending: !!db.prepare("SELECT 1 FROM rv_jobs WHERE order_id=? AND done=0").get(order.id),
    amount,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    createdAt: order.created_at,
  };
}

function installPaymentRoutes(app) {
  billing.installRoutes(app);
  app.post("/api/payments/start", billing.auth.sameOrigin, billing.auth.required, async (req, res) => {
    try {
      const { context, provider } = req.body;
      if (
        !["shop", "registration"].includes(context) ||
        !["paypal", "stripe"].includes(provider)
      )
        throw new Error("Metodo di pagamento non valido");

      if (provider === "stripe") {
        const result = await billing.start({ context, account: req.account, requestKey: req.body.requestKey,
          accepted: req.body.accepted, consentVersion: req.body.consentVersion,
          ...(context === "shop" ? { items: validateCart(req.body.items), customer: validateShopCustomer(req.body.customer) } : { registration: validateRegistration(req.body.registration) }) });
        return res.json(result);
      }
      if (context === "registration") return res.status(503).json({ error: "Le nuove iscrizioni stagionali sono disponibili con Stripe. Per gli abbonamenti PayPal esistenti contatta la segreteria." });
      if (process.env.PAYPAL_CHECKOUT_ENABLED !== "true") return res.status(503).json({ error: "PayPal è temporaneamente non disponibile. Puoi pagare con Stripe." });
      if (emailKey(req.body.customer?.email) !== req.account.email) return res.status(403).json({ error: "Usa l’email verificata." });
      let url;
      if (context === "shop") {
        const items = validateCart(req.body.items);
        const customer = validateShopCustomer(req.body.customer);
        url =
          await startPayPalShop(items, customer);
      } else {
        const registration = validateRegistration(req.body.registration);
        url =
          await startPayPalRegistration(registration);
      }
      if (!url)
        throw new Error("Il gestore non ha restituito la pagina di pagamento");
      res.json({ url });
    } catch (error) {
      res
        .status(error.status || 400)
        .json({ error: error.status || !error.type ? error.message || "Pagamento non disponibile" : "Servizio temporaneamente non disponibile. Controlla I miei pagamenti prima di riprovare." });
    }
  });

  app.get("/paypal/shop/complete", async (req, res) => {
    try {
      const token = String(req.query.token || "");
      const order = db
        .prepare(
          "SELECT * FROM payment_orders WHERE external_id=? AND context='shop' AND provider='paypal'",
        )
        .get(token);
      if (!order) throw new Error("Ordine non trovato");
      if (order.status !== "PAID") {
        await paypalRequest(
          `/v2/checkout/orders/${encodeURIComponent(token)}/capture`,
          {
            method: "POST",
            headers: { "PayPal-Request-Id": `${order.id}-capture` },
          },
        );
        updateOrder(order.id, "PAID");
      }
      res.redirect(
        `/pagamento-confermato.html?tipo=shop&ordine=${encodeURIComponent(order.id)}`,
      );
    } catch (error) {
      res.redirect("/shop-cancel.html");
    }
  });

  app.get("/paypal/subscription/complete", async (req, res) => {
    const local = String(req.query.local || "");
    const order = db
      .prepare(
        "SELECT * FROM payment_orders WHERE id=? AND context='registration' AND provider='paypal'",
      )
      .get(local);
    try {
      if (!order) throw new Error("Iscrizione non trovata");
      if (["PAID", "APPROVED"].includes(order.status))
        return res.redirect(
          `/pagamento-confermato.html?tipo=iscrizione&ordine=${encodeURIComponent(order.id)}`,
        );
      const subscription = await paypalRequest(
        `/v1/billing/subscriptions/${encodeURIComponent(order.external_id)}`,
        { method: "GET" },
      );
      if (!["ACTIVE", "APPROVED"].includes(subscription.status))
        throw new Error("Abbonamento non attivo");
      updateOrder(local, "APPROVED");
      const registration = JSON.parse(order.payload);
      saveSubscription({
        provider: "paypal",
        email: registration.email,
        externalId: order.external_id,
      });
      res.redirect(
        `/pagamento-confermato.html?tipo=iscrizione&ordine=${encodeURIComponent(order.id)}`,
      );
    } catch (error) {
      res.redirect("/cancel.html");
    }
  });

  app.get("/stripe/complete", async (req, res) => {
    try {
      const sessionId = String(req.query.session_id || "");
      if (!sessionId) throw new Error("Sessione Stripe mancante");
      const session = await billing.stripe().checkout.sessions.retrieve(
        sessionId,
        { expand: ["subscription"] },
      );
      const order = await billing.complete(session);
      if (!order) throw new Error("Ordine non trovato");
      res.redirect(
        `/pagamento-confermato.html?tipo=${order.context === "shop" ? "shop" : "iscrizione"}&ordine=${encodeURIComponent(order.id)}`,
      );
    } catch (error) {
      console.error("Ritorno Stripe da verificare:", error.code || error.name);
      const order = db
        .prepare(
          "SELECT id,context FROM payment_orders WHERE external_id=? AND provider='stripe'",
        )
        .get(String(req.query.session_id || ""));
      res.redirect("/pagamento-confermato.html" + (order ? "?ordine=" + encodeURIComponent(order.id) : ""));
    }
  });

  app.post("/paypal/webhook", async (req, res) => {
    try {
      if (!process.env.PAYPAL_WEBHOOK_ID)
        return res.status(503).json({ error: "Webhook PayPal non configurato" });
      const verification = await paypalRequest(
        "/v1/notifications/verify-webhook-signature",
        {
          method: "POST",
          body: JSON.stringify({
            auth_algo: req.get("paypal-auth-algo"),
            cert_url: req.get("paypal-cert-url"),
            transmission_id: req.get("paypal-transmission-id"),
            transmission_sig: req.get("paypal-transmission-sig"),
            transmission_time: req.get("paypal-transmission-time"),
            webhook_id: process.env.PAYPAL_WEBHOOK_ID,
            webhook_event: req.body,
          }),
        },
      );
      if (verification.verification_status !== "SUCCESS")
        return res.sendStatus(403);

      const eventType = String(req.body?.event_type || "");
      const externalId = String(
        req.body?.resource?.billing_agreement_id ||
          req.body?.resource?.id ||
          "",
      );
      const statuses = {
        "BILLING.SUBSCRIPTION.ACTIVATED": "ACTIVE",
        "BILLING.SUBSCRIPTION.CANCELLED": "CANCELED",
        "BILLING.SUBSCRIPTION.SUSPENDED": "SUSPENDED",
        "BILLING.SUBSCRIPTION.EXPIRED": "EXPIRED",
        "BILLING.SUBSCRIPTION.PAYMENT.FAILED": "PAYMENT_FAILED",
      };
      if (externalId && statuses[eventType])
        updateSubscriptionStatus("paypal", externalId, statuses[eventType]);
      res.sendStatus(200);
    } catch (error) {
      console.error("Webhook PayPal non elaborato:", error.message);
      res.sendStatus(400);
    }
  });

  app.get("/api/payments/status/:orderId", billing.auth.required, (req, res) => {
    const order = db
      .prepare("SELECT * FROM payment_orders WHERE id=?")
      .get(String(req.params.orderId || ""));
    if (!order) return res.status(404).json({ error: "Ordine non trovato" });
    const payload = JSON.parse(order.payload);
    if (emailKey(payload.email || payload.customer?.email) !== req.account.email && !req.account.admin)
      return res.status(404).json({ error: "Ordine non trovato" });
    res.set("Cache-Control", "no-store");
    res.json(getOrderPublicSummary(order));
  });


}

module.exports = { installPaymentRoutes, installStripeWebhookRoute, billing, db };
