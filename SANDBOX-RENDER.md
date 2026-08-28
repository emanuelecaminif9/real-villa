# Real Villa — carta, PayPal e prove anticipate

Aggiornamento del 28 agosto 2026. Solo Sandbox: non pronto per incassi reali.

## Cosa cambia

- Le nuove iscrizioni offrono **carta oppure PayPal nella schermata Stripe Checkout**. Il sito apre un’unica sessione; scegli il metodo lì. I due metodi condividono importi, storico, ricevute, controlli duplicati e fine stagione.
- Non servono nuove chiavi PayPal separate su Render per questa integrazione. `PAYPAL_CHECKOUT_ENABLED` riguarda il vecchio shop PayPal diretto, non le nuove iscrizioni. Lasciarlo disattivato durante queste prove.
- La prova anticipata simula un ingresso a settembre: 100 euro di test subito (50 iscrizione + 50 settembre), poi 50 euro dall’8 ottobre all’8 maggio. Non addebita agosto, non cambia l’orologio e non apre le iscrizioni reali prima del 1° settembre.
- Da settembre in poi valgono le regole normali, anche in Sandbox: ingresso a dicembre = 100 euro subito e rinnovi da gennaio; nessun arretrato. Ingresso a maggio = 100 euro senza rinnovi.

Il software richiede ancora accesso email e accettazione delle condizioni: la Sandbox non aggira la verifica dell’identità.

## 1. Render: completare Environment

Nello screenshot ricevuto sono presenti nove nomi di variabili; i valori oscurati non sono verificabili. Le righe nuove necessarie sono indicate sotto. Se una variabile esiste già, modificarla senza crearne un duplicato.

| Nome | Valore per questa prova |
| --- | --- |
| `BASE_URL` | `https://real-villa.onrender.com` |
| `STRIPE_MODE` | `test` |
| `LIVE_PAYMENTS_ENABLED` | `false` |
| `SANDBOX_EARLY_REGISTRATION` | `true` — nuova |
| `STRIPE_SECRET_KEY` | Conservare la propria `sk_test_…` della Sandbox |
| `STRIPE_SUBSCRIPTION_PRICE_ID` | Il `price_…` da 50 EUR al mese della stessa Sandbox |
| `STRIPE_EXPECTED_MONTHLY_CENTS` | `5000` |
| `STRIPE_REGISTRATION_FEE_CENTS` | `5000` — se assente il valore predefinito è già 5000 |
| `SEASON_ID` | `2026-2027` |
| `BILLING_POLICY` | `calendar_full_months_day8` |
| `PAYMENT_TERMS_VERSION` | `2026-2027-sandbox-v4` |
| `PAYMENT_TERMS_APPROVED` | `true` dopo aver letto e confermato le regole del collaudo — nuova |
| `AUTH_SECRET` | Un segreto casuale di almeno 48 caratteri — nuova, conservarlo privato e stabile |
| `MAIL_PROVIDER` | `resend` — nuova |
| `RESEND_API_KEY` | La propria chiave `re_…`, inserita privatamente — nuova |
| `MAIL_FROM` | `Real Villa <onboarding@resend.dev>` per la prova limitata descritta sotto — nuova |

Per generare AUTH_SECRET sul proprio Mac si può usare `openssl rand -hex 32`: copiare il risultato SOLO nel valore su Render, non in chat o su GitHub. Non sostituire un AUTH_SECRET già valido: interromperebbe le sessioni esistenti.

Non creare un secondo abbonamento per i 50 euro di iscrizione. Il server crea le due quote iniziali una tantum e differisce solo il rinnovo mensile.

### Codici email: serve un account Resend

1. Aprire [Resend](https://resend.com/) e creare il proprio account se non esiste.
2. In **API Keys**, creare una chiave per l’invio e inserirla privatamente in `RESEND_API_KEY` su Render.
3. Con il mittente `onboarding@resend.dev`, sul sito accedere **con la stessa email dell’account Resend**. Questo mittente non invia alle altre famiglie. Per altri destinatari serve un dominio mittente verificato.

Non sono stati creati account email né modificati DNS al posto della società. Render Free blocca SMTP sulle porte comuni: il sito usa Resend via HTTPS.

Fonti: [limite del mittente Resend](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain), [Render Free](https://render.com/docs/free).

## 2. Stripe: PayPal nella stessa Sandbox

Aprire la stessa Sandbox a cui appartiene `sk_test_…`. In **Impostazioni → Metodi di pagamento**, verificare PayPal e attivarlo nell’ambiente di test se richiesto. Stripe documenta i pagamenti PayPal ricorrenti come abilitati per impostazione predefinita negli ambienti di test.

Per i test non serve collegare il conto PayPal Business reale. Nel Checkout, selezionare PayPal e seguire la pagina di autorizzazione di prova; se compare il pulsante PayPal con login, Stripe può richiedere un account personale PayPal Sandbox. Non usare credenziali reali per simulare il pagamento. Provare anche autorizzazione rifiutata/annullata: non deve risultare pagato.

Prima del live occorre collegare PayPal Business a Stripe e verificare l’abilitazione ai rinnovi; eventuali approvazioni dipendono dagli account. Non è un’operazione già eseguita da questo aggiornamento.

Fonti: [abbonamenti PayPal su Stripe](https://docs.stripe.com/billing/subscriptions/paypal), [rinnovi PayPal](https://docs.stripe.com/payments/paypal/set-up-future-payments), [test Checkout PayPal](https://docs.stripe.com/payments/paypal/accept-a-payment), [attivazione live](https://docs.stripe.com/payments/paypal/activate).

## 3. Aggiornare il servizio esistente

La cartella da usare è **`/Users/emanuelecaminti/Desktop/REALVILLA-render`**, già collegata al repository esistente. Non creare un altro repository e non estrarre lo ZIP sopra `.git`. Il codice non si pubblica da solo.

Nel Terminale del Mac, controllare prima l’elenco con:

```sh
cd "/Users/emanuelecaminti/Desktop/REALVILLA-render"
git status --short
```

Poi, se l’elenco corrisponde a questo aggiornamento, eseguire il blocco seguente; `&&` interrompe la sequenza in caso di errore:

```sh
git add -- billing-config.js stripe-billing.js public/pagamenti.html public/registration.js public/payment-terms.js public/condizioni-pagamenti.html public/i-miei-pagamenti.html scripts/test.js test/billing.test.js test/calendar.test.js test/http.test.js .env.example SANDBOX-RENDER.md ATTIVAZIONE-SICURA.md VERIFICHE.md &&
git commit -m "Real Villa: carta e PayPal, prove anticipate solo Sandbox [skip render]" &&
git push origin main
```

Non usare force push o reset in caso di errore. Non aggiungere `.env`, database, backup o `node_modules`.

Su Render, salvare le nuove variabili con **Save only**, poi **Manual Deploy → Deploy latest commit** per applicare insieme l’ultimo codice e le impostazioni. Il messaggio `[skip render]` evita un deploy automatico prima della configurazione. Attendere **Live**. Il semplice salvataggio delle variabili non aggiorna il processo già attivo.

Fonte: [variabili Render](https://render.com/docs/configure-environment-variables), [skip deploy Render](https://render.com/docs/deploys#skipping-an-auto-deploy).

## 4. Prima prova

1. Aprire `/i-miei-pagamenti.html`, richiedere il codice alla propria email Resend e accedere. Usare dati fittizi per gli atleti.
2. Aprire `/pagamenti.html`: deve comparire **PROVA SANDBOX** e, prima di settembre, **ingresso a settembre simulato**. Totale 100 euro, primo rinnovo 8 ottobre.
3. Completare i dati e il consenso. **Continua · scegli carta o PayPal** apre il Checkout con entrambi i metodi.
4. Carta test: `4242 4242 4242 4242`, scadenza futura e CVC di tre cifre. PayPal: procedura di test del punto 2. Fare le due prove con due atleti fittizi diversi: lo stesso atleta già iscritto viene bloccato per evitare duplicati.
5. Verificare in Stripe e sul sito 100 euro pagati, un solo abbonamento, primo rinnovo 8 ottobre, ultimo 8 maggio e chiusura tecnica 8 giugno senza rata di giugno. Non considerare la sola pagina di ritorno come prova di pagamento.

Fonte carta di test: [Stripe testing](https://docs.stripe.com/testing).

### Webhook e portale: completare il collaudo

Nella stessa Sandbox configurare la destinazione `https://real-villa.onrender.com/stripe/webhook` con gli eventi elencati in `ATTIVAZIONE-SICURA.md`; mettere il relativo `whsec_…` in `STRIPE_WEBHOOK_SECRET`. Serve a confermare anche senza ritorno del browser e a riconciliare le scadenze. Carta e PayPal via Stripe usano lo stesso webhook.

Per il pulsante del portale documenti configurare `STRIPE_PORTAL_CONFIGURATION_ID=bpc_…` tramite la guida completa; per l’area segreteria impostare `ADMIN_EMAILS` alla propria email verificata. Queste opzioni non sostituiscono le impostazioni email del punto 1. Verificare consegna webhook, ricevute, rinnovi, annullamenti e sospensioni per entrambi i metodi prima delle famiglie.

**Render Free conserva il database solo in modo effimero:** un riavvio/deploy può perdere collegamenti, iscrizioni e protezioni locali dai duplicati. Usare soltanto Sandbox e dati fittizi; dopo un riavvio verificare prima gli abbonamenti su Stripe, non rifare automaticamente la stessa iscrizione. Prima del live servono archivio persistente, backup verificati e tutti i controlli in `ATTIVAZIONE-SICURA.md`.

I test automatici sono simulati: non dimostrano ancora un pagamento riuscito sui tuoi account esterni.
