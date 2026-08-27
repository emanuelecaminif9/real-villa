const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { mkdirSync } = require('node:fs');

function openDatabase(filename = process.env.PAYMENTS_DB_PATH || path.join(__dirname, 'payments.db')) {
  if (filename !== ':memory:') {
    const resolved = path.resolve(filename);
    if (resolved.startsWith(path.join(__dirname, 'public') + path.sep)) throw new Error('Database non ammesso nella cartella pubblica');
    mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS payment_orders (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, context TEXT NOT NULL,
      status TEXT NOT NULL, payload TEXT NOT NULL, external_id TEXT,
      contract_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, email TEXT NOT NULL,
      status TEXT NOT NULL, external_id TEXT, contract_id TEXT,
      next_charge_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_external ON payment_orders(provider, external_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email, provider);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_external ON subscriptions(provider, external_id);
    CREATE TABLE IF NOT EXISTS rv_challenges (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS rv_sessions (
      token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON rv_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS rv_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rv_customers (email TEXT PRIMARY KEY, stripe_id TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rv_orders (
      order_id TEXT PRIMARY KEY REFERENCES payment_orders(id), request_key TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL, fingerprint TEXT NOT NULL, enrollment_key TEXT,
      expected_amount INTEGER NOT NULL, paid_amount INTEGER, currency TEXT NOT NULL DEFAULT 'eur',
      customer_id TEXT NOT NULL, season_json TEXT, checkout_params TEXT NOT NULL,
      session_url TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rv_orders_email ON rv_orders(email, created_at);
    CREATE TABLE IF NOT EXISTS rv_enrollments (key TEXT PRIMARY KEY, order_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rv_events (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, error_code TEXT
    );
    CREATE TABLE IF NOT EXISTS rv_subscriptions (
      stripe_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, order_id TEXT,
      season_end INTEGER, cancel_at INTEGER, pause_json TEXT, stripe_status TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rv_jobs (
      subscription_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, season_end INTEGER NOT NULL,
      done INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0, error_code TEXT
    );
    CREATE TABLE IF NOT EXISTS rv_reconcile_checks (order_id TEXT PRIMARY KEY, checked_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rv_audit (
      id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    PRAGMA optimize;
  `);
  return db;
}
function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = callback(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { openDatabase, transaction };
