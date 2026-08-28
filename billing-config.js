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
  sandboxEarlyRegistration(env);
  if (currentMode === 'live') {
    if (env.LIVE_PAYMENTS_ENABLED !== 'true' || !origin(env).startsWith('https:'))
      throw new PublicError('I pagamenti reali non sono ancora abilitati.', 503);
    requireStorage(env);
    if (!env.STRIPE_WEBHOOK_SECRET || env.STRIPE_RECEIPTS_CONFIGURED !== 'true')
      throw new PublicError('Conferme e ricevute Stripe devono essere configurate prima degli incassi.', 503);
  }
  return currentMode;
}
function sandboxEarlyRegistration(env = process.env) {
  if (env.SANDBOX_EARLY_REGISTRATION !== 'true') return false;
  // Fail closed even if a test flag is accidentally left in a live deployment.
  if (env.STRIPE_MODE !== 'test' || mode(env) !== 'test' || env.LIVE_PAYMENTS_ENABLED !== 'false')
    throw new PublicError('La prova anticipata richiede STRIPE_MODE=test, una chiave di test e LIVE_PAYMENTS_ENABLED=false.', 503);
  return true;
}
const romeDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
const romeHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' });
function calendarParts(milliseconds) {
  return Object.fromEntries(romeDate.formatToParts(new Date(milliseconds)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
function monthStart(year, month) {
  // Modern Europe/Rome midnight; account for CET/CEST rather than the server TZ.
  const utc = Date.UTC(year, month - 1, 1);
  return utc / 1000 - Number(romeHour.format(new Date(utc))) * 3600;
}
function renewalAt(year, month) {
  // A fixed UTC time keeps Stripe's monthly anchor on day 8 even across DST.
  return Date.UTC(year, month - 1, 8, 8) / 1000;
}
function season(env = process.env, clock = Date.now) {
  const earlyTest = sandboxEarlyRegistration(env);
  const years = /^(\d{4})-(\d{4})$/.exec(env.SEASON_ID || '');
  if (!years || Number(years[2]) !== Number(years[1]) + 1 || Number(years[1]) < 2020 || Number(years[2]) > 2100)
    throw new PublicError('La stagione sportiva deve essere configurata dalla società.', 503);
  const startYear = Number(years[1]); const endYear = Number(years[2]);
  const enrollmentEndsAt = monthStart(endYear, 6);
  if (enrollmentEndsAt <= Math.floor(clock() / 1000))
    throw new PublicError('Le iscrizioni online per questa stagione sono chiuse.', 409);
  if (env.BILLING_POLICY !== 'calendar_full_months_day8')
    throw new PublicError('Configurare il piano: iscrizione una tantum, mese d’ingresso intero e rinnovi l’8 fino a maggio.', 503);
  if (!env.PAYMENT_TERMS_VERSION || env.PAYMENT_TERMS_APPROVED !== 'true')
    throw new PublicError('Le condizioni di pagamento devono essere approvate dalla società.', 503);
  const amount = Number(env.STRIPE_EXPECTED_MONTHLY_CENTS || 5000);
  const registrationAmount = Number(env.STRIPE_REGISTRATION_FEE_CENTS || 5000);
  if ([amount, registrationAmount].some(n => !Number.isSafeInteger(n) || n < 1 || n > 1000000))
    throw new PublicError('Importo mensile o quota d’iscrizione non valido.', 503);
  const result = { id: env.SEASON_ID, startYear, endYear, start: monthStart(startYear, 9), enrollmentEndsAt,
    // May is charged in full on May 8. Cancel at the NEXT period boundary:
    // no June invoice and no shortened/prorated May period.
    end: renewalAt(endYear, 6), lastPaymentAt: renewalAt(endYear, 5), amount, registrationAmount,
    billingDay: 8, currency: 'eur', policy: env.BILLING_POLICY, version: env.PAYMENT_TERMS_VERSION,
    sandboxEarlyRegistration: earlyTest };
  return { ...result, consentVersion: digest(JSON.stringify(result)) };
}
function registrationQuote(settings, clock = Date.now) {
  const now = Math.floor(clock() / 1000); const today = calendarParts(clock());
  const actualIndex = today.year * 12 + today.month - 1;
  const firstIndex = settings.startYear * 12 + 8; const lastIndex = settings.endYear * 12 + 4;
  const sandboxCalendarPreview = settings.sandboxEarlyRegistration === true && now < settings.start;
  const currentIndex = sandboxCalendarPreview ? firstIndex : actualIndex;
  if (currentIndex > lastIndex || now >= settings.enrollmentEndsAt)
    throw new PublicError('Le iscrizioni online per questa stagione sono chiuse.', 409);
  if (!sandboxCalendarPreview && (now < settings.start || currentIndex < firstIndex))
    throw new PublicError(`Le iscrizioni per la stagione ${settings.id} aprono il 1° settembre ${settings.startYear}.`, 409);
  const monthKey = index => `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`;
  const paidMonth = monthKey(currentIndex);
  const renewals = [];
  for (let index = currentIndex + 1; index <= lastIndex; index++)
    renewals.push({ month: monthKey(index), at: renewalAt(Math.floor(index / 12), index % 12 + 1), amount: settings.amount });
  const firstRenewalAt = renewals[0]?.at || null;
  if (firstRenewalAt && (firstRenewalAt < now + 48 * 3600 || firstRenewalAt > now + 730 * 86400))
    throw new PublicError('La prima scadenza non è compatibile con questo tentativo. Contatta la segreteria.', 409);
  const result = { ...settings, paidMonth, currentMonthAmount: settings.amount, sandboxCalendarPreview,
    dueNow: settings.registrationAmount + settings.amount, firstRenewalAt, renewals,
    checkoutMode: renewals.length ? 'subscription' : 'payment',
    quoteValidUntil: Math.min(sandboxCalendarPreview ? settings.start : monthStart(today.year, today.month + 1), settings.enrollmentEndsAt) };
  // Stable within the same calendar month; invalidates stale consent at rollover.
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
module.exports = { PublicError, digest, emailKey, objectId, origin, mode, allowMoney, requireStorage, season, registrationQuote, safeStripeUrl, route };
