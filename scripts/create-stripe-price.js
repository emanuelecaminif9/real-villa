require("dotenv").config();
const Stripe = require("stripe");

async function main() {
  if (!process.env.STRIPE_SECRET_KEY)
    throw new Error("Inserisci STRIPE_SECRET_KEY nel file .env");

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const product = await stripe.products.create({
    name: "Iscrizione ASD Real Villa",
    description: "Quota mensile di iscrizione alla stagione sportiva",
  });
  const price = await stripe.prices.create({
    currency: "eur",
    unit_amount: 5000,
    recurring: { interval: "month" },
    product: product.id,
  });

  console.log(
    `Piano creato correttamente. Inserisci nelle variabili del server:\nSTRIPE_SUBSCRIPTION_PRICE_ID=${price.id}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
