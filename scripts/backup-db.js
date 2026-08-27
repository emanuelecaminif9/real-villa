require('dotenv').config({ quiet: true });
const { DatabaseSync, backup } = require('node:sqlite');
const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
async function main() {
  const source = path.resolve(process.env.PAYMENTS_DB_PATH || path.join(__dirname, '..', 'payments.db'));
  if (!existsSync(source)) throw new Error('Database esistente non trovato: nessun archivio creato o sostituito.');
  const folder = path.resolve(process.env.BACKUP_DIR || path.join(path.dirname(source), 'backups'));
  if (folder.startsWith(path.join(__dirname, '..', 'public') + path.sep)) throw new Error('Backup non ammessi nella cartella pubblica.');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const destination = path.join(folder, 'realvilla-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db');
  if (existsSync(destination)) throw new Error('Il backup esiste già: nessun file sovrascritto.');
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, destination); } finally { db.close(); }
  const verify = new DatabaseSync(destination, { readOnly: true });
  try { if (verify.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Verifica del backup fallita'); } finally { verify.close(); }
  console.log('Backup verificato:', destination);
  console.log('Il backup contiene dati personali: conservarlo in modo riservato e copiarlo anche fuori dal server.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
