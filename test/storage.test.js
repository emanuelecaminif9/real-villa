const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../database');
test('additive schema preserves legacy orders and subscriptions across restarts', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'realvilla-migration-test-')); const file = path.join(dir, 'payments.db');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const legacy = new DatabaseSync(file);
  legacy.exec(`CREATE TABLE payment_orders(id TEXT PRIMARY KEY,provider TEXT,context TEXT,status TEXT,payload TEXT,external_id TEXT,contract_id TEXT,created_at TEXT);
    CREATE TABLE subscriptions(id TEXT PRIMARY KEY,provider TEXT,email TEXT,status TEXT,external_id TEXT,contract_id TEXT,next_charge_at TEXT,created_at TEXT);`);
  legacy.prepare('INSERT INTO payment_orders VALUES (?,?,?,?,?,?,?,?)').run('old-order', 'stripe', 'registration', 'PAID', '{}', 'cs_old', null, '2026-08-01');
  legacy.prepare('INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?)').run('old-sub', 'stripe', 'parent@example.test', 'ACTIVE', 'sub_old', 'old-order', null, '2026-08-01'); legacy.close();
  for (let run = 0; run < 2; run++) { const db = openDatabase(file); assert.equal(db.prepare('SELECT status FROM payment_orders').get().status, 'PAID'); assert.equal(db.prepare('SELECT external_id FROM subscriptions').get().external_id, 'sub_old'); assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); db.close(); }
});
