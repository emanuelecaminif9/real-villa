const express = require("express");
const path = require("path");
const { paymentAvailability } = require('./payment-availability');
if (process.env.REALVILLA_TEST !== '1') require("dotenv").config({ quiet: true });
const {
  installPaymentRoutes,
  installStripeWebhookRoute,
  billing,
} = require("./payments");

const app = express();
const publicDir = path.join(__dirname, 'public');
app.disable('x-powered-by');
// Render adds one trusted reverse proxy. Do not trust arbitrary forwarded hops.
if (process.env.RENDER === 'true') app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'DENY');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});
// Stripe verifica la firma sul corpo HTTP originale, prima del parser JSON.
installStripeWebhookRoute(app);
app.use(express.json({ limit: "200kb" }));
// Conserva l'integrazione, ma impedisce nuovi pagamenti finché la società non
// abilita esplicitamente il servizio. Il blocco è server-side, non solo grafico.
app.use(paymentAvailability({ env: process.env, publicDir }));
app.use(express.static(publicDir));

installPaymentRoutes(app);
app.get('/healthz', (req, res) => res.status(200).json({ ok: true }));

const port = process.env.PORT || 3000;
if (require.main === module) {
  billing.startWorker();
  app.listen(port, () =>
    console.log(`Server Real Villa attivo sulla porta ${port}`),
  );
}

module.exports = app;
