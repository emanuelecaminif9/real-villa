require('dotenv').config({ quiet: true });
const { mode, allowMoney, season, origin } = require('../billing-config');
const checks = [];
function check(name, fn) { try { fn(); checks.push({ controllo: name, esito: 'OK' }); } catch (error) { checks.push({ controllo: name, esito: error.message }); } }
check('Indirizzo pubblico', () => origin());
check('Modalità e chiave', () => mode());
check('Abilitazione incassi', () => allowMoney());
check('Stagione e condizioni', () => season());
check('Accesso email', () => { if ((process.env.AUTH_SECRET || '').length < 48 || !process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.MAIL_FROM) throw new Error('Configurazione accesso o email incompleta'); });
check('Webhook', () => { if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error('Segreto webhook mancante'); });
check('Portale documenti', () => { if (!process.env.STRIPE_PORTAL_CONFIGURATION_ID) throw new Error('Configurazione portale mancante'); });
console.table(checks);
console.log('Controllo locale: non sono state inviate email né eseguite operazioni Stripe. Le impostazioni esterne e il disco persistente vanno verificati anche sui rispettivi pannelli.');
if (checks.some(c => c.esito !== 'OK')) process.exitCode = 1;
