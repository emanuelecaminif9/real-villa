const express = require("express");
const path = require("path");
require("dotenv").config();
const {
  installPaymentRoutes,
  installStripeWebhookRoute,
} = require("./payments");

const app = express();
// Stripe verifica la firma sul corpo HTTP originale, prima del parser JSON.
installStripeWebhookRoute(app);
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public")));

installPaymentRoutes(app);

const port = process.env.PORT || 3000;
if (require.main === module)
  app.listen(port, () =>
    console.log(`Server Real Villa attivo sulla porta ${port}`),
  );

module.exports = app;
