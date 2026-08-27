# Collegamento pagamenti — ASD Real Villa

Il sito usa PayPal Business e Stripe tramite integrazioni server-side. Le chiavi private restano nel file
`.env` del server e non vengono mai inviate al browser.

## Flussi presenti

### Shop

1. Il cliente compone il carrello in `Shop.html`.
2. `checkout.html` raccoglie nome, email, telefono, note e metodo di pagamento.
3. Il browser invia prodotti e contatti a `POST /api/payments/start`.
4. Il server ricalcola prezzi e totale dal proprio catalogo, quindi crea:
   - un ordine PayPal Checkout con acquisizione immediata; oppure
   - una sessione Stripe Checkout per carta e metodi compatibili.
5. Il cliente paga sulla pagina protetta del gestore.
6. Il server verifica l'esito con il gestore e apre
   `pagamento-confermato.html`, mostrando riferimento, importo e metodo.

### Iscrizioni

- Oggi: quota iniziale di 50 EUR.
- Primo mese: nessun altro addebito.
- Dal mese successivo: 50 EUR al mese fino alla disdetta.

Con PayPal il calendario è gestito da un piano Subscriptions. Con Stripe viene
creato un abbonamento Billing: Stripe esegue i rinnovi e comunica al sito gli
esiti tramite webhook firmati.

## Variabili del server

Copia `.env.example` in `.env` e configura:

```dotenv
BASE_URL=https://www.dominio-reale.it
PORT=3000
PAYMENTS_DB_PATH=./payments.db

PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_SUBSCRIPTION_PLAN_ID=...
PAYPAL_WEBHOOK_ID=...

STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SUBSCRIPTION_PRICE_ID=price_...
```

`BASE_URL` deve essere il dominio HTTPS pubblico, senza slash finale. Non
pubblicare mai `.env`, `payments.db`, Client Secret o API Key.

## Collegare PayPal alla società

1. Aprire o convertire l'account della società in PayPal Business e completare
   la verifica del titolare e del conto di accredito.
2. Nel PayPal Developer Dashboard creare una REST app Sandbox e copiare Client
   ID e Client Secret nel `.env`.
3. Con `PAYPAL_MODE=sandbox`, eseguire una sola volta `npm run setup:paypal`.
   Copiare l'ID restituito in `PAYPAL_SUBSCRIPTION_PLAN_ID`.
4. Nelle impostazioni della stessa app creare il webhook
   `https://www.dominio-reale.it/paypal/webhook`, salvare il suo ID in
   `PAYPAL_WEBHOOK_ID` e abilitare almeno questi eventi:
   - `BILLING.SUBSCRIPTION.ACTIVATED`
   - `BILLING.SUBSCRIPTION.CANCELLED`
   - `BILLING.SUBSCRIPTION.SUSPENDED`
   - `BILLING.SUBSCRIPTION.EXPIRED`
   - `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
   - `PAYMENT.SALE.COMPLETED`
5. Eseguire un acquisto e un'iscrizione completi con gli utenti di test Sandbox.
6. Per la produzione creare/configurare l'app Live, sostituire le credenziali,
   impostare `PAYPAL_MODE=live` e creare un nuovo piano Live: gli ID Sandbox non
   funzionano in produzione.

Il server verifica la firma dei webhook tramite l'API PayPal prima di aggiornare
lo stato locale degli abbonamenti.

## Collegare Stripe alla società

1. Aprire un account Stripe intestato alla società, completare la verifica del
   rappresentante legale e collegare l'IBAN societario.
2. Nella Dashboard Stripe attivare la modalità di test e copiare le chiavi
   `pk_test_...` e `sk_test_...`. La chiave segreta va inserita solo nel server.
3. Inserire `STRIPE_SECRET_KEY` nel file `.env`, quindi eseguire una sola volta
   `npm run setup:stripe`. Copiare l'ID restituito in
   `STRIPE_SUBSCRIPTION_PRICE_ID`. Il comando crea il piano da 50 EUR al mese.
4. In Stripe Workbench > Webhooks creare la destinazione HTTPS
   `https://www.dominio-reale.it/stripe/webhook`, selezionare almeno gli eventi:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copiare il signing secret `whsec_...` in `STRIPE_WEBHOOK_SECRET`.
6. Provare sia un acquisto shop sia un'iscrizione ricorrente in modalità test.
7. Solo dopo i test sostituire le chiavi con `pk_live_...` e `sk_live_...`,
   creare un nuovo webhook Live e un nuovo piano Live. Gli oggetti Test non sono
   disponibili nell'ambiente Live.

Il sito non riceve né salva i dati delle carte: il cliente paga sulla pagina
ospitata da Stripe. Il server conferma l'ordine solo dopo aver interrogato
Stripe o verificato la firma del webhook.

## Pubblicazione e gestione

- Richiede Node.js 22.5 o successivo (`node:sqlite` è usato dal backend).
- Avvio: `npm install`, poi `npm start`.
- Il server deve avere un disco persistente per `payments.db`.
- I rinnovi mensili vengono eseguiti direttamente da PayPal o Stripe; il sito
  riceve gli aggiornamenti tramite webhook.
- Proteggere il sito con HTTPS e conservare backup cifrati del database.
- Prima del Live verificare importi, conto di accredito, rimborsi, disdette,
  pagamenti falliti e riconciliazione contabile.

## Test locali

```bash
npm test
npm start
```

Aprire `http://localhost:3000`. In Sandbox completare i flussi sui portali dei
gestori; non usare carte o account reali.
