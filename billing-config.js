const path = require('node:path');
const { createHash } = require('node:crypto');

class PublicError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const digest = value => createHash('sha256').update(value).digest('hex');
const emailKey = value => String(value || '').trim().toLowerCase();
const objectId = value => typeof value === 'string' ? value : value?.id || '';

function origin(env = process.env) {
  const url = new URL(env.BASE_URL || 'http://localhost:3000');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new PublicError('Indirizzo del sito non configurato correttamente.', 503);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    throw new PublicError('Il sito deve utilizzare HTTPS.', 503);
  return url.origin;
}
function mode(env = process.env) {
  const value = env.STRIPE_MODE || 'test';
  if (!['test', 'live'].includes(value)) throw new PublicError('Modalità Stripe non valida.', 503);
  if (!String(env.STRIPE_SECRET_KEY || '').startsWith(`sk_${value}_`))
    throw new PublicError('Chiave Stripe assente o non coerente con la modalità configurata.', 503);
  return value;
}
function requireStorage(env = process.env) {
  const location = env.PAYMENTS_DB_PATH || '';
  if (env.PAYMENTS_STORAGE_CONFIRMED !== 'true' || !path.isAbsolute(location) ||
      location === path.resolve(location, '..') || path.resolve(location).startsWith(__dirname + path.sep))
    throw new PublicError('Archivio persistente dei pagamenti non confermato. Contatta la segreteria.', 503);
}
function allowMoney(env = process.env) {
  const currentMode = mode(env);
  if (currentMode === 'live') {
    if (env.LIVE_PAYMENTS_ENABLED !== 'true' || !origin(env).startsWith('https:'))
      throw new PublicError('I pagamenti reali non sono ancora abilitati.', 503);
    requireStorage(env);
    if (!env.STRIPE_WEBHOOK_SECRET || env.STRIPE_RECEIPTS_CONFIGURED !== 'true')
      throw new PublicError('Conferme e ricevute Stripe devono essere configurate prima degli incassi.', 503);
  }
  return currentMode;
}
function season(env = process.env, clock = Date.now) {
  if (!env.SEASON_ID || !/^[\w-]{3,40}$/.test(env.SEASON_ID))
    throw new PublicError('La stagione sportiva deve essere configurata dalla società.', 503);
  const raw = env.SEASON_END_AT || '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(raw))
    throw new PublicError('Manca la data di fine stagione con il fuso orario.', 503);
  const end = Math.floor(Date.parse(raw) / 1000);
  const day = raw.slice(0, 10);
  if (!Number.isFinite(end) || new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day)
    throw new PublicError('Data di fine stagione non valida.', 503);
  if (end <= Math.floor(clock() / 1000) + 3600)
    throw new PublicError('Le iscrizioni online per questa stagione sono chiuse.', 409);
  // No unapproved decision about calendar-day billing or full final instalments.
  if (env.BILLING_POLICY !== 'anniversary_prorated_end')
    throw new PublicError('La società deve approvare la regola delle mensilità prima di attivare le iscrizioni.', 503);
  if (!env.PAYMENT_TERMS_VERSION || env.PAYMENT_TERMS_APPROVED !== 'true')
    throw new PublicError('Le condizioni di pagamento devono essere approvate dalla società.', 503);
  const amount = Number(env.STRIPE_EXPECTED_MONTHLY_CENTS || 5000);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000)
    throw new PublicError('Importo mensile non valido.', 503);
  const result = { id: env.SEASON_ID, end, amount, currency: 'eur', policy: env.BILLING_POLICY, version: env.PAYMENT_TERMS_VERSION };
  return { ...result, consentVersion: digest(JSON.stringify(result)) };
}
function safeStripeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com')) ? url.href : null;
  } catch { return null; }
}
function route(handler) {
  return async (req, res, next) => {
    try { await handler(req, res, next); }
    catch (error) {
      if (!(error instanceof PublicError)) console.error('Operazione non completata:', error.code || error.type || error.name);
      res.status(error instanceof PublicError ? error.status : 503).json({ error: error instanceof PublicError ? error.message : 'Servizio temporaneamente non disponibile. Non ripetere il pagamento; controlla I miei pagamenti o contatta la segreteria.' });
    }
  };
}
module.exports = { PublicError, digest, emailKey, objectId, origin, mode, allowMoney, requireStorage, season, safeStripeUrl, route };
