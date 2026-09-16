const path = require('node:path');

const unavailablePages = new Set([
  '/iscrizioni.html',
  '/shop.html',
  '/pagamenti.html',
  '/checkout.html',
  '/i-miei-pagamenti.html',
  '/condizioni-pagamenti.html',
]);

function paymentsPublic(env = process.env) {
  return String(env.PUBLIC_PAYMENTS_ENABLED || '').trim().toLowerCase() === 'true';
}

function paymentAvailability({ env = process.env, publicDir }) {
  const holdingPage = path.join(publicDir, 'pagamenti-presto.html');
  return (req, res, next) => {
    if (paymentsPublic(env)) return next();
    const requestPath = String(req.path || '').toLowerCase();
    if ((req.method === 'GET' || req.method === 'HEAD') && unavailablePages.has(requestPath)) {
      res.set('Cache-Control', 'no-store');
      return res.sendFile(holdingPage);
    }
    if (req.method === 'POST' && requestPath === '/api/payments/start') {
      res.set('Cache-Control', 'no-store');
      return res.status(503).json({ error: 'I pagamenti online saranno disponibili a breve. Contatta la segreteria.' });
    }
    return next();
  };
}

module.exports = { paymentAvailability, paymentsPublic, unavailablePages };
