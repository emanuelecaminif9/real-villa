require('dotenv').config({ quiet: true });
const Stripe = require('stripe');
const { mode, allowMoney } = require('../billing-config');
async function main() {
  const current = mode();
  if (current === 'live' && !process.argv.includes('--live')) throw new Error('Account live: operazione non eseguita. Richiesta opzione esplicita --live dopo il collaudo.');
  allowMoney();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 15000, maxNetworkRetries: 2 });
  const result = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'ASD Real Villa · Documenti e metodo di pagamento' },
    features: { customer_update: { enabled: false }, invoice_history: { enabled: true }, payment_method_update: { enabled: true }, subscription_cancel: { enabled: false }, subscription_update: { enabled: false } },
  }, { idempotencyKey: 'realvilla-documents-portal-v1' });
  console.log('Configurazione dedicata creata. Nessun abbonamento o pagamento modificato.');
  console.log('STRIPE_PORTAL_CONFIGURATION_ID=' + result.id);
}
main().catch(error => { console.error('Configurazione non completata:', error.code || (error.type ? error.type : error.message)); process.exitCode = 1; });
