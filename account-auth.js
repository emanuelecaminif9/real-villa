const { randomBytes, randomInt, createHmac, timingSafeEqual } = require('node:crypto');
const nodemailer = require('nodemailer');
const { PublicError, emailKey, origin, route } = require('./billing-config');
const { transaction } = require('./database');

function createAccountAuth({ db, env = process.env, clock = Date.now, sendMail } = {}) {
  const cookieName = 'rv_session';
  const seconds = () => Math.floor(clock() / 1000);
  function secret() {
    if (Buffer.byteLength(env.AUTH_SECRET || '') < 48) throw new PublicError('Accesso riservato non ancora configurato.', 503);
    return env.AUTH_SECRET;
  }
  const hash = value => createHmac('sha256', secret()).update(value).digest('hex');
  function available() {
    try { secret(); origin(env); return !!(sendMail || (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.MAIL_FROM)); }
    catch { return false; }
  }
  function limit(key, max, duration) {
    const hashed = hash('rate:' + key);
    transaction(db, () => {
      const old = db.prepare('SELECT * FROM rv_limits WHERE key=?').get(hashed);
      if (old && old.expires_at > seconds() && old.count >= max) throw new PublicError('Troppi tentativi. Attendi qualche minuto prima di riprovare.', 429);
      db.prepare(`INSERT INTO rv_limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count, expires_at=excluded.expires_at`)
        .run(hashed, old && old.expires_at > seconds() ? old.count + 1 : 1, old && old.expires_at > seconds() ? old.expires_at : seconds() + duration);
    });
  }
  function sameOrigin(req, res, next) {
    if (req.get('origin') !== origin(env) || req.get('x-rv-request') !== '1')
      return res.status(403).json({ error: 'Richiesta non autorizzata. Ricarica la pagina.' });
    next();
  }
  function current(req) {
    if (!available()) return null;
    const token = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = db.prepare('SELECT email,expires_at FROM rv_sessions WHERE token_hash=?').get(hash('session:' + token));
    if (!session || session.expires_at <= seconds()) return null;
    return { email: session.email, admin: (env.ADMIN_EMAILS || '').split(',').map(emailKey).includes(session.email) };
  }
  function required(req, res, next) {
    req.account = current(req);
    if (!req.account) return res.status(401).json({ error: 'Verifica la tua email nell’area I miei pagamenti per continuare.' });
    next();
  }
  function admin(req, res, next) {
    if (!req.account?.admin) return res.status(403).json({ error: 'Area riservata alla segreteria.' });
    next();
  }
  let transport;
  async function mail(message) {
    if (sendMail) return sendMail(message);
    if (!available()) throw new PublicError('Invio dei codici di accesso non ancora disponibile.', 503);
    const port = Number(env.SMTP_PORT || 465);
    if (![465, 587].includes(port)) throw new PublicError('Servizio email non configurato correttamente.', 503);
    transport ||= nodemailer.createTransport({
      host: env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    await transport.sendMail({ from: env.MAIL_FROM, ...message });
  }
  function install(app) {
    app.use('/api/account', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    app.get('/api/account/me', (req, res) => res.json({ account: current(req), available: available() }));
    app.post('/api/account/request-code', sameOrigin, route(async (req, res) => {
      if (!available()) throw new PublicError('L’area pagamenti sarà disponibile dopo la configurazione del servizio email.', 503);
      const email = emailKey(req.body.email);
      if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PublicError('Inserisci un indirizzo email valido.');
      limit('send-ip:' + req.ip, 12, 900); limit('send-email:' + email, 3, 900);
      const id = randomBytes(24).toString('hex');
      const code = String(randomInt(10000000, 100000000));
      db.prepare('INSERT INTO rv_challenges(id,email,code_hash,expires_at) VALUES (?,?,?,?)').run(id, email, hash(id + ':' + code), seconds() + 600);
      try {
        await mail({ to: email, subject: 'Real Villa · Codice di accesso ai pagamenti', text: `Il tuo codice di accesso è: ${code}\n\nÈ valido per 10 minuti e può essere usato una sola volta. Non comunicarlo a nessuno, nemmeno alla segreteria.\n\nSe non hai richiesto l’accesso, ignora questa email.\nASD Real Villa` });
      } catch (error) {
        db.prepare('UPDATE rv_challenges SET consumed=1 WHERE id=?').run(id);
        throw new PublicError('Non siamo riusciti a inviare il codice. Riprova più tardi o contatta la segreteria.', 503);
      }
      res.json({ challenge: id, message: 'Codice inviato. Controlla anche la cartella spam.' });
    }));
    app.post('/api/account/verify-code', sameOrigin, route(async (req, res) => {
      limit('verify-ip:' + req.ip, 30, 900);
      const id = String(req.body.challenge || ''); const code = String(req.body.code || '');
      let email;
      // Failed attempts must commit, not roll back with the validation error.
      transaction(db, () => {
        const row = db.prepare('SELECT * FROM rv_challenges WHERE id=?').get(id);
        if (!row || row.consumed || row.expires_at <= seconds() || row.attempts >= 5) return;
        db.prepare('UPDATE rv_challenges SET attempts=attempts+1 WHERE id=?').run(id);
        if (!/^\d{8}$/.test(code) || !timingSafeEqual(Buffer.from(hash(id + ':' + code)), Buffer.from(row.code_hash))) return;
        db.prepare('UPDATE rv_challenges SET consumed=1 WHERE id=?').run(id); email = row.email;
      });
      if (!email) throw new PublicError('Codice errato, scaduto o già utilizzato. Richiedi un nuovo codice.', 401);
      const token = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO rv_sessions VALUES (?,?,?)').run(hash('session:' + token), email, seconds() + 28800);
      res.cookie(cookieName, token, { httpOnly: true, secure: origin(env).startsWith('https:'), sameSite: 'lax', maxAge: 28800000, path: '/' });
      res.json({ account: { email, admin: (env.ADMIN_EMAILS || '').split(',').map(emailKey).includes(email) } });
    }));
    app.post('/api/account/logout', sameOrigin, route(async (req, res) => {
      const token = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
      if (token && available()) db.prepare('DELETE FROM rv_sessions WHERE token_hash=?').run(hash('session:' + token));
      res.clearCookie(cookieName, { path: '/', sameSite: 'lax', secure: origin(env).startsWith('https:') }); res.json({ ok: true });
    }));
  }
  function cleanup() {
    db.prepare('DELETE FROM rv_challenges WHERE expires_at<?').run(seconds() - 86400);
    db.prepare('DELETE FROM rv_sessions WHERE expires_at<?').run(seconds());
    db.prepare('DELETE FROM rv_limits WHERE expires_at<?').run(seconds());
  }
  return { current, required, admin, sameOrigin, available, limit, install, cleanup };
}
module.exports = { createAccountAuth };
