require("dotenv").config({ quiet: true });
const Stripe = require("stripe");
const { mode, allowMoney } = require('../billing-config');

async function main() {
  if (!process.env.STRIPE_SECRET_KEY)
    throw new Error("Inserisci STRIPE_SECRET_KEY nel file .env");
  if (mode() === 'live' && !process.argv.includes('--live')) throw new Error('Creazione live bloccata: usare --live solo dopo approvazione della società.');
  allowMoney();
  if (process.env.STRIPE_SUBSCRIPTION_PRICE_ID) {
    console.log('È già configurato un prezzo. Verificarlo nel pannello Stripe prima di crearne un altro.');
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const product = await stripe.products.create({
    name: "Mensilità ASD Real Villa",
    description: "Quota mensile sportiva. La quota unica d’iscrizione è distinta.",
  }, { idempotencyKey: 'realvilla-monthly-product-v2' });
  const price = await stripe.prices.create({
    currency: "eur",
    unit_amount: 5000,
    recurring: { interval: "month" },
    product: product.id,
  }, { idempotencyKey: 'realvilla-monthly-5000-v2' });

  console.log(
    `Piano creato correttamente. Inserisci nelle variabili del server:\nSTRIPE_SUBSCRIPTION_PRICE_ID=${price.id}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
