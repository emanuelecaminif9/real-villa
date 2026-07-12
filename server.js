const express = require("express");
const path = require("path");
require("dotenv").config();
const { installPaymentRoutes } = require("./payments");

const app = express();
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public")));

installPaymentRoutes(app);

const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`Server Real Villa attivo sulla porta ${port}`),
);
