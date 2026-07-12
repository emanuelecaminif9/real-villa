require("dotenv").config();

const apiBase =
  process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

async function request(endpoint, token, options = {}) {
  const response = await fetch(`${apiBase}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || data.error_description || "Errore PayPal");
  return data;
}

async function main() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET)
    throw new Error(
      "Inserisci PAYPAL_CLIENT_ID e PAYPAL_CLIENT_SECRET nel file .env",
    );
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");
  const tokenResponse = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok)
    throw new Error(
      tokenData.error_description || "Autenticazione PayPal fallita",
    );

  const product = await request(
    "/v1/catalogs/products",
    tokenData.access_token,
    {
      method: "POST",
      body: JSON.stringify({
        name: "Iscrizione ASD Real Villa",
        description: "Iscrizione e quota mensile ASD Real Villa",
        type: "SERVICE",
      }),
    },
  );
  const plan = await request("/v1/billing/plans", tokenData.access_token, {
    method: "POST",
    body: JSON.stringify({
      product_id: product.id,
      name: "Iscrizione 50 EUR + quota mensile 50 EUR",
      description: "50 EUR oggi; 50 EUR al mese a partire dal mese successivo",
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "TRIAL",
          sequence: 1,
          total_cycles: 1,
          pricing_scheme: { fixed_price: { value: "0", currency_code: "EUR" } },
        },
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 2,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: "50.00", currency_code: "EUR" },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee: { value: "50.00", currency_code: "EUR" },
        setup_fee_failure_action: "CANCEL",
        payment_failure_threshold: 2,
      },
    }),
  });
  console.log(
    `Piano creato correttamente. Inserisci nel file .env:\nPAYPAL_SUBSCRIPTION_PLAN_ID=${plan.id}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
