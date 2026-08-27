const { rmSync } = require("node:fs");

const databasePath = `/tmp/real-villa-smoke-${process.pid}.db`;
process.env.PAYMENTS_DB_PATH = databasePath;
const app = require("../server");

const server = app.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  let exitCode = 0;
  try {
    const checkout = await fetch(`${base}/checkout.html`);
    const area = await fetch(`${base}/i-miei-pagamenti.html`);
    const staff = await fetch(`${base}/segreteria.html`);
    const terms = await fetch(`${base}/condizioni-pagamenti.html`);
    const confirmation = await fetch(
      `${base}/pagamento-confermato.html?tipo=shop&ordine=demo`,
    );
    const modulistica = await fetch(`${base}/Modulistica.html`);
    const calendario = await fetch(`${base}/Calendario.html`);
    const squadre = await fetch(`${base}/Squadre.html`);
    const shop = await fetch(`${base}/Shop.html`);
    const invalidPayment = await fetch(`${base}/api/payments/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const unsupportedProvider = await fetch(`${base}/api/payments/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "shop", provider: "unsupported" }),
    });
    const stripeWebhook = await fetch(`${base}/stripe/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const missingOrder = await fetch(
      `${base}/api/payments/status/not-found`,
    );
    const results = {
      area: area.status,
      staff: staff.status,
      terms: terms.status,
      checkout: checkout.status,
      confirmation: confirmation.status,
      modulistica: modulistica.status,
      calendario: calendario.status,
      squadre: squadre.status,
      shop: shop.status,
      invalidPayment: invalidPayment.status,
      unsupportedProvider: unsupportedProvider.status,
      stripeWebhook: stripeWebhook.status,
      missingOrder: missingOrder.status,
    };
    console.log(results);
    if (
      results.checkout !== 200 ||
      results.area !== 200 ||
      results.staff !== 200 ||
      results.terms !== 200 ||
      results.confirmation !== 200 ||
      results.modulistica !== 200 ||
      results.calendario !== 200 ||
      results.squadre !== 200 ||
      results.shop !== 200 ||
      results.invalidPayment !== 403 ||
      results.unsupportedProvider !== 403 ||
      results.stripeWebhook !== 503 ||
      results.missingOrder !== 401
    )
      throw new Error("Smoke test non superato");
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    server.close(() => {
      rmSync(databasePath, { force: true });
      process.exit(exitCode);
    });
  }
});

server.on("error", (error) => {
  console.error(error);
  rmSync(databasePath, { force: true });
  process.exit(1);
});
