const { DatabaseSync } = require("node:sqlite");
const { randomUUID, createHash } = require("node:crypto");
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
const addMonth = (date = new Date()) => {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + 1);
  return result.toISOString();
};
const shortId = (prefix) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(
    0,
    18,
  );
const customerId = (email) =>
  `RV${createHash("sha256").update(email).digest("hex").slice(0, 20)}`;

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
  db.prepare(
    "INSERT OR REPLACE INTO subscriptions (id,provider,email,status,external_id,contract_id,next_charge_at,created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    randomUUID(),
    provider,
    email.toLowerCase(),
    "ACTIVE",
    externalId || null,
    contractId || null,
    provider === "nexi" ? addMonth() : null,
    now(),
  );
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

async function startPayPalShop(items) {
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
    payload: items,
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

const nexiBase = () =>
  process.env.NEXI_MODE === "live"
    ? "https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1"
    : "https://xpaysandbox.nexigroup.com/api/phoenix-0.0/psp/api/v1";

async function nexiRequest(endpoint, options = {}, idempotent = false) {
  if (!process.env.NEXI_API_KEY)
    throw new Error("Chiave Nexi XPay non configurata");
  const headers = {
    "X-Api-Key": process.env.NEXI_API_KEY,
    "Correlation-Id": randomUUID(),
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (idempotent) headers["Idempotency-Key"] = randomUUID();
  const response = await fetch(`${nexiBase()}${endpoint}`, {
    ...options,
    headers,
  });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok)
    throw new Error(
      data.errors?.[0]?.description || "Operazione Nexi non riuscita",
    );
  return data;
}

async function startNexi({ context, payload, amount, recurring }) {
  const id = shortId(context === "shop" ? "NXS" : "NXR");
  const contractId = recurring ? shortId("RVC") : null;
  const email = recurring ? payload.email : "";
  const body = {
    order: {
      orderId: id,
      amount: String(amount),
      currency: "EUR",
      customerId: recurring ? customerId(email) : undefined,
      description: recurring
        ? "Iscrizione ASD Real Villa"
        : "Ordine shop ASD Real Villa",
    },
    paymentSession: {
      actionType: "PAY",
      amount: String(amount),
      recurrence: recurring
        ? {
            action: "CONTRACT_CREATION",
            contractId,
            contractType: "MIT_SCHEDULED",
            contractFrequency: "30",
          }
        : { action: "NO_RECURRING" },
    },
    language: "ita",
    resultUrl: `${baseUrl}/nexi/result/${id}`,
    cancelUrl: `${baseUrl}/${context === "shop" ? "shop-cancel.html" : "cancel.html"}`,
    notificationUrl: `${baseUrl}/nexi/notification`,
  };
  const result = await nexiRequest("/orders/hpp", {
    method: "POST",
    body: JSON.stringify(body),
  });
  saveOrder({
    id,
    provider: "nexi",
    context,
    status: "PENDING",
    payload,
    contractId,
  });
  return result.hostedPage;
}

function successfulNexiOrder(data) {
  const operations = data.operations || data.order?.operations || [];
  return operations.some((operation) =>
    ["EXECUTED", "AUTHORIZED"].includes(operation.operationResult),
  );
}

async function chargeDueNexiSubscriptions() {
  const due = db
    .prepare(
      "SELECT * FROM subscriptions WHERE provider='nexi' AND status='ACTIVE' AND next_charge_at<=?",
    )
    .all(now());
  for (const subscription of due) {
    const orderId = shortId("NXM");
    try {
      const result = await nexiRequest(
        "/orders/mit",
        {
          method: "POST",
          body: JSON.stringify({
            order: {
              orderId,
              amount: "5000",
              currency: "EUR",
              customerId: customerId(subscription.email),
              description: "Quota mensile ASD Real Villa",
            },
            contractId: subscription.contract_id,
          }),
        },
        true,
      );
      const ok = ["EXECUTED", "AUTHORIZED"].includes(
        result.operation?.operationResult,
      );
      db.prepare(
        "UPDATE subscriptions SET status=?, next_charge_at=? WHERE id=?",
      ).run(
        ok ? "ACTIVE" : "PAYMENT_FAILED",
        ok
          ? addMonth(subscription.next_charge_at)
          : subscription.next_charge_at,
        subscription.id,
      );
    } catch (error) {
      console.error(
        "Addebito Nexi non riuscito:",
        subscription.id,
        error.message,
      );
      db.prepare(
        "UPDATE subscriptions SET status='PAYMENT_FAILED' WHERE id=?",
      ).run(subscription.id);
    }
  }
}

function installPaymentRoutes(app) {
  app.post("/api/payments/start", async (req, res) => {
    try {
      const { context, provider } = req.body;
      if (
        !["shop", "registration"].includes(context) ||
        !["paypal", "nexi"].includes(provider)
      )
        throw new Error("Metodo di pagamento non valido");
      let url;
      if (context === "shop") {
        const items = validateCart(req.body.items);
        const total = items.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0,
        );
        url =
          provider === "paypal"
            ? await startPayPalShop(items)
            : await startNexi({
                context,
                payload: items,
                amount: total,
                recurring: false,
              });
      } else {
        const registration = validateRegistration(req.body.registration);
        url =
          provider === "paypal"
            ? await startPayPalRegistration(registration)
            : await startNexi({
                context,
                payload: registration,
                amount: 5000,
                recurring: true,
              });
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
          "SELECT id FROM payment_orders WHERE external_id=? AND context='shop'",
        )
        .get(token);
      if (!order) throw new Error("Ordine non trovato");
      await paypalRequest(
        `/v2/checkout/orders/${encodeURIComponent(token)}/capture`,
        {
          method: "POST",
          headers: { "PayPal-Request-Id": `${order.id}-capture` },
        },
      );
      updateOrder(order.id, "PAID");
      res.redirect("/shop-success.html");
    } catch (error) {
      res.redirect("/shop-cancel.html");
    }
  });

  app.get("/paypal/subscription/complete", async (req, res) => {
    const local = String(req.query.local || "");
    const order = db
      .prepare(
        "SELECT * FROM payment_orders WHERE id=? AND context='registration'",
      )
      .get(local);
    try {
      if (!order) throw new Error("Iscrizione non trovata");
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
      res.redirect("/success.html");
    } catch (error) {
      res.redirect("/cancel.html");
    }
  });

  app.get("/nexi/result/:orderId", async (req, res) => {
    const order = db
      .prepare("SELECT * FROM payment_orders WHERE id=? AND provider='nexi'")
      .get(req.params.orderId);
    if (!order) return res.redirect("/cancel.html");
    try {
      const result = await nexiRequest(
        `/orders/${encodeURIComponent(order.id)}`,
        { method: "GET" },
      );
      if (!successfulNexiOrder(result))
        throw new Error("Pagamento non completato");
      updateOrder(order.id, "PAID");
      if (order.context === "registration") {
        const registration = JSON.parse(order.payload);
        saveSubscription({
          provider: "nexi",
          email: registration.email,
          contractId: order.contract_id,
        });
      }
      res.redirect(
        order.context === "shop" ? "/shop-success.html" : "/success.html",
      );
    } catch (error) {
      res.redirect(
        order.context === "shop" ? "/shop-cancel.html" : "/cancel.html",
      );
    }
  });

  app.post("/nexi/notification", (req, res) => {
    res.sendStatus(200);
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
          "SELECT * FROM subscriptions WHERE email=? AND status IN ('ACTIVE','PAYMENT_FAILED') ORDER BY created_at DESC",
        )
        .get(email);
      if (!subscription)
        return res.status(404).json({ error: "Nessun abbonamento trovato" });
      const paymentOrder =
        subscription.provider === "paypal"
          ? db
              .prepare(
                "SELECT payload FROM payment_orders WHERE external_id=? AND context='registration'",
              )
              .get(subscription.external_id)
          : db
              .prepare(
                "SELECT payload FROM payment_orders WHERE contract_id=? AND context='registration'",
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
      else
        await nexiRequest(
          `/contracts/${encodeURIComponent(subscription.contract_id)}/deactivation`,
          { method: "POST" },
        );
      db.prepare("UPDATE subscriptions SET status='CANCELED' WHERE id=?").run(
        subscription.id,
      );
      res.json({ message: "Abbonamento disdetto correttamente" });
    } catch (error) {
      res.status(400).json({ error: error.message || "Disdetta non riuscita" });
    }
  });

  setTimeout(chargeDueNexiSubscriptions, 15000);
  setInterval(chargeDueNexiSubscriptions, 6 * 60 * 60 * 1000);
}

module.exports = { installPaymentRoutes };
