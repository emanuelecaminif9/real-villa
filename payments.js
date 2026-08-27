const express = require("express");
const Stripe = require("stripe");
const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const path = require("path");

const baseUrl = (process.env.BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const db = new DatabaseSync(
  process.env.PAYMENTS_DB_PATH || path.join(__dirname, "payments.db"),
);

db.exec(`
  CREATE TABLE IF NOT EXISTS payment_orders (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, context TEXT NOT NULL,
    status TEXT NOT NULL, payload TEXT NOT NULL, external_id TEXT,
    contract_id TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, email TEXT NOT NULL,
    status TEXT NOT NULL, external_id TEXT, contract_id TEXT,
    next_charge_at TEXT, created_at TEXT NOT NULL
  );
`);

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
const shortId = (prefix) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(
    0,
    18,
  );

function validateRegistration(data) {
  const fields = [
    "nome_ragazzo",
    "nome_genitore",
    "email",
    "telefono",
    "pacchetto",
  ];
  if (!data || fields.some((field) => !String(data[field] || "").trim()))
    throw new Error("Compila tutti i dati dell’iscrizione");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
    throw new Error("Indirizzo email non valido");
  if (!["piccoli-campioni", "primi-calci", "dal-2017"].includes(data.pacchetto))
    throw new Error("Categoria non valida");
  return Object.fromEntries(
    fields.map((field) => [field, String(data[field]).trim().slice(0, 200)]),
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

let stripeClient;
let stripeClientKey;
function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Chiave segreta Stripe non configurata");
  if (!stripeClient || stripeClientKey !== key) {
    stripeClient = new Stripe(key);
    stripeClientKey = key;
  }
  return stripeClient;
}

function stripeObjectId(value) {
  if (typeof value === "string") return value;
  return value?.id ? String(value.id) : "";
}

async function startStripeShop(items, customer) {
  const id = shortId("STS");
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      locale: "it",
      customer_email: customer.email,
      client_reference_id: id,
      metadata: { local_order_id: id, context: "shop" },
      line_items: items.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: "eur",
          unit_amount: item.price,
          product_data: {
            name: item.name,
            description: `Taglia: ${item.size}`,
          },
        },
      })),
      payment_intent_data: {
        metadata: { local_order_id: id, context: "shop" },
      },
      success_url: `${baseUrl}/stripe/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/shop-cancel.html`,
    },
    { idempotencyKey: id },
  );
  saveOrder({
    id,
    provider: "stripe",
    context: "shop",
    status: "PENDING",
    payload: { items, customer },
    externalId: session.id,
  });
  return session.url;
}

async function startStripeRegistration(registration) {
  if (!process.env.STRIPE_SUBSCRIPTION_PRICE_ID)
    throw new Error("Piano mensile Stripe non configurato");
  const id = shortId("STR");
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      locale: "it",
      customer_email: registration.email,
      client_reference_id: id,
      metadata: { local_order_id: id, context: "registration" },
      line_items: [
        { price: process.env.STRIPE_SUBSCRIPTION_PRICE_ID, quantity: 1 },
      ],
      subscription_data: {
        metadata: { local_order_id: id, context: "registration" },
      },
      success_url: `${baseUrl}/stripe/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel.html`,
    },
    { idempotencyKey: id },
  );
  saveOrder({
    id,
    provider: "stripe",
    context: "registration",
    status: "PENDING",
    payload: registration,
    externalId: session.id,
  });
  return session.url;
}

function completeStripeCheckout(session) {
  const localId = String(
    session.metadata?.local_order_id || session.client_reference_id || "",
  );
  const order = localId
    ? db
        .prepare("SELECT * FROM payment_orders WHERE id=? AND provider='stripe'")
        .get(localId)
    : db
        .prepare(
          "SELECT * FROM payment_orders WHERE external_id=? AND provider='stripe'",
        )
        .get(session.id);
  if (!order) throw new Error("Ordine Stripe non trovato");
  if (session.payment_status !== "paid")
    throw new Error("Pagamento Stripe non ancora completato");

  if (order.status !== "PAID") updateOrder(order.id, "PAID", session.id);
  if (order.context === "registration") {
    const subscriptionId = stripeObjectId(session.subscription);
    if (!subscriptionId)
      throw new Error("Abbonamento Stripe non disponibile");
    const registration = JSON.parse(order.payload);
    saveSubscription({
      provider: "stripe",
      email: registration.email,
      externalId: subscriptionId,
      contractId: order.id,
    });
  }
  return order;
}

function stripeSubscriptionIdFromInvoice(invoice) {
  return (
    stripeObjectId(invoice.subscription) ||
    stripeObjectId(invoice.parent?.subscription_details?.subscription)
  );
}

async function processStripeEvent(event) {
  if (
    ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(
      event.type,
    )
  ) {
    const session = event.data.object;
    if (session.payment_status === "paid") completeStripeCheckout(session);
    return;
  }

  if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object;
    const statuses = {
      active: "ACTIVE",
      trialing: "ACTIVE",
      past_due: "PAYMENT_FAILED",
      unpaid: "PAYMENT_FAILED",
      incomplete: "PAYMENT_FAILED",
      incomplete_expired: "EXPIRED",
      paused: "SUSPENDED",
      canceled: "CANCELED",
    };
    updateSubscriptionStatus(
      "stripe",
      subscription.id,
      statuses[subscription.status] || String(subscription.status).toUpperCase(),
    );
    return;
  }

  if (["invoice.payment_failed", "invoice.payment_succeeded"].includes(event.type)) {
    const subscriptionId = stripeSubscriptionIdFromInvoice(event.data.object);
    updateSubscriptionStatus(
      "stripe",
      subscriptionId,
      event.type === "invoice.payment_succeeded" ? "ACTIVE" : "PAYMENT_FAILED",
    );
  }
}

function installStripeWebhookRoute(app) {
  app.post(
    "/stripe/webhook",
    express.raw({ type: "application/json", limit: "300kb" }),
    async (req, res) => {
      try {
        if (!process.env.STRIPE_WEBHOOK_SECRET)
          return res.status(503).json({ error: "Webhook Stripe non configurato" });
        const signature = req.get("stripe-signature");
        if (!signature) return res.sendStatus(400);
        const event = getStripeClient().webhooks.constructEvent(
          req.body,
          signature,
          process.env.STRIPE_WEBHOOK_SECRET,
        );
        await processStripeEvent(event);
        res.sendStatus(200);
      } catch (error) {
        console.error("Webhook Stripe non elaborato:", error.message);
        res.sendStatus(400);
      }
    },
  );
}

function getOrderPublicSummary(order) {
  const payload = JSON.parse(order.payload);
  const items =
    order.context === "shop"
      ? Array.isArray(payload)
        ? payload
        : payload.items || []
      : [];
  const amount =
    order.context === "registration"
      ? 5000
      : items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return {
    id: order.id,
    context: order.context,
    provider: order.provider,
    status: order.status,
    confirmed: ["PAID", "APPROVED"].includes(order.status),
    amount,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    createdAt: order.created_at,
  };
}

function installPaymentRoutes(app) {
  app.post("/api/payments/start", async (req, res) => {
    try {
      const { context, provider } = req.body;
      if (
        !["shop", "registration"].includes(context) ||
        !["paypal", "stripe"].includes(provider)
      )
        throw new Error("Metodo di pagamento non valido");

      let url;
      if (context === "shop") {
        const items = validateCart(req.body.items);
        const customer = validateShopCustomer(req.body.customer);
        url =
          provider === "paypal"
            ? await startPayPalShop(items, customer)
            : await startStripeShop(items, customer);
      } else {
        const registration = validateRegistration(req.body.registration);
        url =
          provider === "paypal"
            ? await startPayPalRegistration(registration)
            : await startStripeRegistration(registration);
      }
      if (!url)
        throw new Error("Il gestore non ha restituito la pagina di pagamento");
      res.json({ url });
    } catch (error) {
      res
        .status(400)
        .json({ error: error.message || "Pagamento non disponibile" });
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
      const session = await getStripeClient().checkout.sessions.retrieve(
        sessionId,
        { expand: ["subscription"] },
      );
      const order = completeStripeCheckout(session);
      res.redirect(
        `/pagamento-confermato.html?tipo=${order.context === "shop" ? "shop" : "iscrizione"}&ordine=${encodeURIComponent(order.id)}`,
      );
    } catch (error) {
      console.error("Ritorno Stripe non elaborato:", error.message);
      const order = db
        .prepare(
          "SELECT context FROM payment_orders WHERE external_id=? AND provider='stripe'",
        )
        .get(String(req.query.session_id || ""));
      res.redirect(order?.context === "shop" ? "/shop-cancel.html" : "/cancel.html");
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

  app.get("/api/payments/status/:orderId", (req, res) => {
    const order = db
      .prepare("SELECT * FROM payment_orders WHERE id=?")
      .get(String(req.params.orderId || ""));
    if (!order) return res.status(404).json({ error: "Ordine non trovato" });
    res.set("Cache-Control", "no-store");
    res.json(getOrderPublicSummary(order));
  });

  app.post("/api/subscriptions/cancel", async (req, res) => {
    try {
      const email = String(req.body.email || "")
        .trim()
        .toLowerCase();
      const telefono = String(req.body.telefono || "").replace(/\D/g, "");
      if (!telefono)
        return res
          .status(400)
          .json({ error: "Numero di telefono obbligatorio" });
      const subscription = db
        .prepare(
          "SELECT * FROM subscriptions WHERE email=? AND provider IN ('paypal','stripe') AND status IN ('ACTIVE','PAYMENT_FAILED') ORDER BY created_at DESC",
        )
        .get(email);
      if (!subscription)
        return res.status(404).json({ error: "Nessun abbonamento trovato" });

      const paymentOrder =
        subscription.provider === "paypal"
          ? db
              .prepare(
                "SELECT payload FROM payment_orders WHERE external_id=? AND context='registration' AND provider='paypal'",
              )
              .get(subscription.external_id)
          : db
              .prepare(
                "SELECT payload FROM payment_orders WHERE id=? AND context='registration' AND provider='stripe'",
              )
              .get(subscription.contract_id);
      const registeredPhone = paymentOrder
        ? String(JSON.parse(paymentOrder.payload).telefono || "").replace(
            /\D/g,
            "",
          )
        : "";
      if (!registeredPhone || !registeredPhone.endsWith(telefono.slice(-9)))
        return res
          .status(403)
          .json({ error: "I dati inseriti non corrispondono all’abbonamento" });

      if (subscription.provider === "paypal")
        await paypalRequest(
          `/v1/billing/subscriptions/${encodeURIComponent(subscription.external_id)}/cancel`,
          {
            method: "POST",
            body: JSON.stringify({ reason: "Richiesta del cliente" }),
          },
        );
      else await getStripeClient().subscriptions.cancel(subscription.external_id);

      db.prepare("UPDATE subscriptions SET status='CANCELED' WHERE id=?").run(
        subscription.id,
      );
      res.json({ message: "Abbonamento disdetto correttamente" });
    } catch (error) {
      res.status(400).json({ error: error.message || "Disdetta non riuscita" });
    }
  });
}

module.exports = { installPaymentRoutes, installStripeWebhookRoute };
