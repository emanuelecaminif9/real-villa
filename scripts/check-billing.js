require('dotenv').config({ quiet: true });
const { mode, allowMoney, season, registrationQuote, origin } = require('../billing-config');
const { mailConfiguration } = require('../mail-delivery');
const checks = [];
function check(name, fn) { try { fn(); checks.push({ controllo: name, esito: 'OK' }); } catch (error) { checks.push({ controllo: name, esito: error.message }); } }
check('Indirizzo pubblico', () => origin());
check('Modalità e chiave', () => mode());
check('Abilitazione incassi', () => allowMoney());
check('Stagione e condizioni', () => registrationQuote(season()));
check('Accesso email', () => { if (Buffer.byteLength(process.env.AUTH_SECRET || '') < 48) throw new Error('Segreto accesso incompleto'); mailConfiguration(); });
check('Webhook', () => { if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error('Segreto webhook mancante'); });
check('Portale documenti', () => { if (!process.env.STRIPE_PORTAL_CONFIGURATION_ID) throw new Error('Configurazione portale mancante'); });
console.table(checks);
console.log('Controllo locale: non sono state inviate email né eseguite operazioni Stripe. Le impostazioni esterne e il disco persistente vanno verificati anche sui rispettivi pannelli.');
if (checks.some(c => c.esito !== 'OK')) process.exitCode = 1;
