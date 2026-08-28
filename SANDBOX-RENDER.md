# Real Villa — prossimo passo: prove su Render

Le modifiche sono già nella cartella `/Users/emanuelecaminti/Desktop/REALVILLA`. Non è stato effettuato un caricamento su GitHub o un deploy su Render. Lo ZIP consegnato è una copia dei sorgenti aggiornati, senza credenziali, database o cronologia Git: non serve estrarlo sopra la cartella di lavoro.

## 1. Apertura delle iscrizioni confermata

Il caso concordato è pronto: il 20 settembre si pagano 100 euro (50 iscrizione + 50 settembre), poi 50 euro ogni 8 da ottobre a maggio. Il mese d’ingresso viene pagato subito anche entrando prima dell’8, senza un secondo addebito nello stesso mese: confermare anche questa applicazione prima del live.

**Le iscrizioni aprono il 1° settembre 2026 alle 00:00, ora italiana. Non sono previste iscrizioni anticipate ad agosto.** Il messaggio di blocco prima dell’apertura è intenzionale, anche in Sandbox: non è un errore della chiave Stripe. Il vecchio `PRESEASON_REGISTRATION_ENABLED` è stato eliminato dalla configurazione e, se ancora presente su Render, viene ignorato.

I test automatici inclusi simulano il passaggio dal 31 agosto al 1° settembre e verificano 100 euro subito, senza una seconda rata l’8 settembre; il primo rinnovo è l’8 ottobre. È possibile prepararne email, prezzo e webhook prima dell’apertura. Per una prova anticipata end-to-end con date diverse serve un ambiente di collaudo separato: non cambiare l’orologio o la stagione del sito pubblico per aggirare il blocco.

## 2. Preparare le email dei codici di accesso

Render Free blocca le porte SMTP. Il sito ora supporta Resend via HTTPS, mantenendo l’accesso con codice monouso. [Documentazione Render](https://render.com/docs/free).

1. Aprire [Resend](https://resend.com/) e creare il proprio account, se non esiste già.
2. Nella sezione **API Keys**, creare una chiave con permesso di invio email. Conservarla privatamente; non inviarla in chat né salvarla su GitHub.
3. Per la prima prova senza dominio usare `MAIL_FROM=Real Villa <onboarding@resend.dev>`.
4. Sul sito richiedere il codice usando **la stessa email con cui è stato creato l’account Resend**. Quel mittente di prova non può inviare ad altre famiglie. Per altri destinatari serve un proprio dominio verificato. [Limiti ufficiali del mittente di prova](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

Per il live usare un dominio mittente della società verificato e completare le verifiche privacy e di recapito. L’integrazione software non crea automaticamente un account Resend e non approva le condizioni del fornitore al posto della società.

## 3. Valori da inserire su Render

Aprire il servizio **real-villa → Environment → Edit**. Non incollare segreti nell’HTML, nelle chat, nei log o nei file pubblici. Non modificare `AUTH_SECRET` se è già configurato correttamente.

| Nome | Valore |
| --- | --- |
| `BASE_URL` | `https://real-villa.onrender.com` |
| `STRIPE_MODE` | `test` |
| `LIVE_PAYMENTS_ENABLED` | `false` |
| `STRIPE_SECRET_KEY` | La chiave `sk_test_…` della Sandbox, inserita privatamente |
| `STRIPE_SUBSCRIPTION_PRICE_ID` | Il `price_…` da 50 EUR **al mese**, nella stessa Sandbox |
| `STRIPE_EXPECTED_MONTHLY_CENTS` | `5000` |
| `STRIPE_REGISTRATION_FEE_CENTS` | `5000` |
| `SEASON_ID` | `2026-2027` |
| `BILLING_POLICY` | `calendar_full_months_day8` |
| `PAYMENT_TERMS_VERSION` | `2026-2027-sandbox-v3` |
| `PAYMENT_TERMS_APPROVED` | `true` soltanto dopo aver letto e approvato le regole per il collaudo |
| `MAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | La propria chiave Resend `re_…`, inserita privatamente |
| `MAIL_FROM` | `Real Villa <onboarding@resend.dev>` per la sola prova limitata del punto 2 |
| `AUTH_SECRET` | Un valore casuale di almeno 48 caratteri, generato con un password manager e conservato stabile |
| `ADMIN_EMAILS` | La propria email autorizzata per la segreteria; altre email separate da virgola |
| `PAYMENTS_STORAGE_CONFIRMED` | `false` su Render Free |
| `PAYPAL_CHECKOUT_ENABLED` | `false` durante questo collaudo Stripe |

I puntini nei riferimenti alle chiavi sono descrittivi: non sono valori da copiare. La chiave pubblicabile Stripe non serve per questo Checkout ospitato. La quota d’iscrizione è una voce una tantum creata dal server: **non creare un secondo abbonamento da 50 euro per l’iscrizione**. Il prezzo mensile già creato può essere riutilizzato se corrisponde a questi requisiti.

Rimuovere i vecchi `SEASON_END_AT` e `PRESEASON_REGISTRATION_ENABLED`: non vengono più usati per le nuove iscrizioni. Conservare l’attuale `PAYMENTS_DB_PATH` se vi sono dati da verificare; su un nuovo ambiente Free di sola prova è possibile usare `./payments.db`, sapendo che i dati sono effimeri. Non impostare un finto disco persistente e non sostituire il database locale con quello dello ZIP.

### Webhook e portale

- Nella **stessa Sandbox Stripe**, configurare la destinazione `https://real-villa.onrender.com/stripe/webhook` con gli eventi elencati in [ATTIVAZIONE-SICURA.md](ATTIVAZIONE-SICURA.md), quindi impostare su Render il relativo `STRIPE_WEBHOOK_SECRET=whsec_…`.
- Per il pulsante «Documenti e metodo di pagamento» occorre anche `STRIPE_PORTAL_CONFIGURATION_ID=bpc_…`. Il portale deve permettere storico e aggiornamento carta, ma non cambio piano o disdetta: questi ultimi sono gestiti dal sito. Lo strumento `npm run setup:portal` crea una configurazione dedicata usando le chiavi Sandbox del proprio computer; non eseguirlo in live per una prova.
- Attivare e verificare le ricevute Stripe come descritto nella guida completa. Non impostare `STRIPE_RECEIPTS_CONFIGURED=true` prima della verifica.

Su Render scegliere **Save only** se il codice nuovo non è ancora stato caricato, poi distribuire insieme codice e configurazione. Se il codice è già presente, usare **Save, rebuild, and deploy** / **Save and deploy**, secondo la voce disponibile. Un semplice salvataggio senza distribuzione non applica i nuovi valori al processo già attivo. [Gestione delle variabili Render](https://render.com/docs/configure-environment-variables).

## 4. Caricare il codice, quando configurazione e regole sono pronte

Non è necessario creare un altro repository: la cartella REALVILLA è già collegata al progetto esistente. In GitHub Desktop è possibile selezionarla, controllare le modifiche, fare il commit e usare **Push origin**. Verificare che fra i file caricati ci sia anche il nuovo `mail-delivery.js`, oltre a `billing-config.js`, `account-auth.js` e `stripe-billing.js`. Non caricare `.env`, database, backup o `node_modules`.

Se si usa il Terminale, questi comandi sono un’alternativa da eseguire **uno alla volta**, interrompendosi in caso di errore. Sono limitati ai file di questo aggiornamento:

```sh
cd "/Users/emanuelecaminti/Desktop/REALVILLA"
git status --short
git add -- .env.example ATTIVAZIONE-SICURA.md VERIFICHE.md SANDBOX-RENDER.md account-auth.js billing-config.js mail-delivery.js stripe-billing.js public/account.js public/condizioni-pagamenti.html public/pagamenti.html public/payment-terms.js public/registration.js scripts/check-billing.js scripts/create-stripe-price.js scripts/test.js test/billing.test.js test/calendar.test.js test/fake-stripe.js test/http.test.js test/mail.test.js
git diff --cached --stat
git commit -m "Real Villa: quota iscrizione e calendario mensilita Sandbox"
git push origin main
```

Prima del commit, verificare che l’elenco contenga solo ciò che si intende pubblicare. Se GitHub segnala modifiche remote o un conflitto, non usare force push e non fare reset: fermarsi e verificare.

In Render controllare repository `emanuelecaminif9/real-villa`, ramo `main`, tipo **Web Service / Node**, build `npm ci`, avvio `npm start`. Il caricamento può avviare automaticamente il deploy; se non lo fa, scegliere **Manual Deploy → Deploy latest commit**. Attendere lo stato **Live**. La pubblicazione del codice non abilita gli incassi reali, che restano bloccati dai valori di prova.

## 5. Prima prova e controlli indispensabili

1. Aprire **I miei pagamenti**, richiedere il codice alla propria email autorizzata dal mittente Resend e accedere. Controllare anche spam e log di consegna nel proprio pannello Resend.
2. Dal 1° settembre aprire **Iscrizioni → pagamento**. Prima di procedere verificare importo subito, mensilità e prossima data: per un ingresso a settembre devono comparire 100 euro subito e l’8 ottobre come primo rinnovo. Prima del 1° settembre il checkout d’iscrizione deve restare bloccato; l’accesso email può invece essere provato appena configurato.
3. Completare un pagamento utilizzando esclusivamente una carta di prova indicata nella [documentazione Stripe](https://docs.stripe.com/testing). Non usare una carta reale per questo collaudo.
4. Controllare conferma, storico e ricevuta. Nella Sandbox Stripe verificare importo iniziale, carta salvata, prima mensilità e fine programmata. Può apparire «trial / prova»: il differimento riguarda soltanto i rinnovi, non rende gratuita l’iscrizione o l’eventuale mese già pagato.
5. Verificare le consegne webhook. Le prove locali simulate non dimostrano che il webhook o la casella email reali siano configurati correttamente.
6. Collaudare separatamente l’intera sequenza di rinnovi, il caso del 20 settembre, maggio, disdetta e sospensioni secondo la checklist completa. Non cambiare l’orologio del server online per simulare altri mesi.

### Attenzione al piano Free

Il database SQLite locale si può perdere a ogni riavvio, deploy o sospensione del servizio: le protezioni locali dai duplicati e i riferimenti degli atleti non sopravvivono a tale perdita. **Usare solo dati fittizi, non riutilizzare un atleta di prova dopo una perdita di archivio senza prima controllare Stripe e non invitare famiglie a pagare realmente.** Stripe non perde i propri pagamenti per un riavvio del sito. Prima degli incassi reali serve storage persistente, servizio adeguato e verifica del ripristino. [Limiti ufficiali Render Free](https://render.com/docs/free).

L’acquisto di un dominio Aruba è separato dall’hosting dell’app: il normale Hosting Linux Aruba non esegue questo server Node.js. Si può collegare il dominio al servizio Render compatibile, senza caricare tutto su Hosting Linux. [Compatibilità Aruba](https://guide.aruba.it/faq/hosting-e-domini/linguaggi-e-spazio-web-linux), [domini personalizzati Render](https://render.com/docs/custom-domains).
