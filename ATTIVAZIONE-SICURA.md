# Real Villa — attivazione controllata dei pagamenti

Questa versione è preparata per il collaudo, non è un’autorizzazione a passare subito agli incassi reali. Il sito online, l’account Stripe e gli abbonamenti esistenti non sono stati modificati durante lo sviluppo.

## Cosa è stato aggiunto

- Area «I miei pagamenti», accesso con codice email monouso, storico Stripe paginato e ricevute.
- Un genitore può avere più abbonamenti; vengono mostrati anche più profili Stripe storici, senza fonderli o modificarli.
- I nuovi checkout riutilizzano un cliente Stripe solo DOPO la verifica dell’email.
- Disdetta del singolo abbonamento con data visibile e conferma; non estende una scadenza già prevista e non genera rimborsi automatici.
- Scadenza stagionale per i nuovi abbonamenti, verificata tramite notifiche Stripe e riconciliazione periodica.
- Area segreteria riservata a email autorizzate: stato delle posizioni e apertura del singolo abbonamento nel pannello Stripe.
- Sospensioni, rimborsi e modifiche amministrative si eseguono nel pannello Stripe, con le autorizzazioni e l’autenticazione a due fattori di Stripe. Non esistono pulsanti pubblici che possano sospendere gli incassi a piacere.
- Protezioni contro i doppi invii, importi non coerenti, notifiche duplicate e accesso ai dati di altri clienti.
- Conferma del pagamento basata sull’esito verificato, mai sulla sola apertura di una pagina.

## Regole della stagione e limiti dell’attivazione

La regola comunicata è: iscrizione una tantum 50 euro; mensilità intera 50 euro da settembre a maggio; rinnovi il giorno 8. Un ingresso il 20 settembre comporta 100 euro subito (50 iscrizione + 50 settembre), poi 50 euro ogni 8 da ottobre a maggio. Totale di una stagione intera: 500 euro, inclusa l’iscrizione, prima di eventuali esenzioni.

Il codice applica il pagamento intero del mese d’ingresso anche a chi entra prima dell’8: quel mese non viene addebitato una seconda volta. In caso di ingresso a maggio il pagamento è una tantum di 100 euro e non viene creato un abbonamento senza rinnovi. Non vengono recuperate automaticamente mensilità anteriori all’ingresso.

La società ha confermato che le iscrizioni reali partono il 1° settembre 2026 alle 00:00, ora italiana. Solo per il collaudo, `SANDBOX_EARLY_REGISTRATION=true` simula un ingresso a settembre prima dell’apertura: 100 euro di prova subito, poi 50 euro dall’8 ottobre a maggio. Richiede contemporaneamente `STRIPE_MODE=test`, chiave `sk_test_...` e `LIVE_PAYMENTS_ENABLED=false`; configurazioni live con questa opzione sono rifiutate. Non cambia l’orologio, non riapre stagioni chiuse e non anticipa gli incassi reali. Il vecchio `PRESEASON_REGISTRATION_ENABLED` resta ignorato.

Le nuove sottoscrizioni utilizzano un differimento Stripe (`trial_end`) soltanto per la componente ricorrente. Iscrizione e mese d’ingresso sono voci una tantum, da pagare subito. Nel pannello Stripe può comparire “trial / prova”: non significa che la mensilità iniziale sia gratuita. Il Checkout richiede un metodo di pagamento: carta oppure autorizzazione PayPal. Entrambi appartengono allo stesso sistema Stripe e alla stessa scadenza stagionale.

Per incassare integralmente maggio senza una rata di giugno, la cancellazione Stripe è programmata sul confine del periodo successivo, l’8 giugno, allo stesso orario UTC del rinnovo. L’ultima nuova mensilità è quella dell’8 maggio; l’8 giugno non deve essere emessa un’ulteriore rata. Le nuove iscrizioni chiudono alla fine del 31 maggio, ora italiana. Non cambiare la cancellazione al 31 maggio: accorciare in anticipo un periodo Stripe futuro può causare un importo proporzionale.

Il calendario è un limite alle nuove mensilità, non un annullamento di eventuali fatture precedenti non saldate. Sospensioni e disdette anticipate possono ridurre le rate previste e non estendono la stagione. Gli abbonamenti già esistenti mantengono le proprie regole: non è stata eseguita alcuna migrazione automatica.

Le condizioni della pagina «Mensilità e pagamenti» sono una base operativa da approvare con la società e il consulente. Integrare prima degli incassi i dati legali completi, l’informativa privacy per i dati raccolti, le condizioni contrattuali e le regole di recesso/rimborso applicabili. Il codice non certifica la conformità legale o fiscale.

## 1. Proteggere l’archivio PRIMA di pubblicare

Non sostituire la cartella originale senza conservarne una copia. Non cancellare o sostituire `.git`, `.env` o il database già utilizzato dal server.

Su Render il disco ordinario è effimero: un nuovo deploy può perdere i dati locali. Prima di cambiare versione verificare dove si trova l’attuale `payments.db` e farne un backup coerente, compreso il contenuto presente nel journal WAL. Non basta copiare il solo file mentre il servizio sta scrivendo.

Il comando `npm run backup:db`, eseguito sul server che possiede il database, utilizza il backup SQLite e ne verifica l’integrità. Copiare il backup anche fuori dal server, in un archivio riservato, e provarne il ripristino su una copia. Non mettere database o backup su GitHub.

Per questa architettura serve un servizio Render con disco persistente e una sola istanza. Montare il disco, per esempio in `/var/data`, trasferire l’archivio con un intervento controllato e impostare:

```
PAYMENTS_DB_PATH=/var/data/realvilla/payments.db
PAYMENTS_STORAGE_CONFIRMED=true
```

Il flag è una conferma dell’operatore, non una verifica automatica del contratto Render. Con più istanze serve un’architettura diversa, con database condiviso e coordinamento delle operazioni: non basta aggiungere repliche a questa versione SQLite.

Se l’archivio precedente è già andato perso, fermare la migrazione e riconciliare ordini e iscrizioni con Stripe/PayPal. Questa versione non inventa né ricostruisce automaticamente dati amministrativi mancanti.

## 2. Configurare accesso e invio email

In Render → Environment impostare i campi del file `.env.example` senza pubblicare segreti nel repository:

- `AUTH_SECRET`: valore casuale di almeno 48 caratteri, da un password manager. Conservarlo stabile; cambiarlo disconnette le sessioni e invalida i codici pendenti.
- Su Render Free: `MAIL_PROVIDER=resend`, `RESEND_API_KEY` e `MAIL_FROM`. L’invio avviene via HTTPS e mantiene la verifica del codice monouso. Occorre creare/configurare il proprio account Resend; nessuna email è stata inviata durante lo sviluppo.
- Per prove senza un dominio verificato, Resend permette `MAIL_FROM=Real Villa <onboarding@resend.dev>` soltanto verso l’indirizzo dell’account Resend. Per altri destinatari e per il live occorre un dominio mittente verificato; il mittente `resend.dev` viene rifiutato dal codice in modalità live.
- In alternativa, su un server che consente SMTP: `MAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT` (465 o 587), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. TLS obbligatorio. Render Free blocca le porte SMTP: inserire le credenziali SMTP su quel piano non basta.
- `ADMIN_EMAILS`: email del personale autorizzato, separate da virgola. Non è una lista pubblica.

Verificare mittente autorizzato e impostazioni SPF/DKIM/DMARC con il fornitore email, recapito e cartella spam. I codici di accesso scadono dopo 10 minuti, sono monouso e ammettono al massimo 5 tentativi. Le sessioni durano 8 ore. Non condividere codici; proteggere anche le caselle email del personale con autenticazione a due fattori.

Per le operazioni finanziarie, ogni addetto deve avere il proprio accesso autorizzato a Stripe con autenticazione a due fattori; l’accesso alla segreteria del sito, da solo, non dà accesso al pannello Stripe.

## 3. Configurare Stripe nella stessa Sandbox

Mantenere `STRIPE_MODE=test` e `LIVE_PAYMENTS_ENABLED=false`.

- `BASE_URL`: indirizzo esatto del servizio di collaudo, senza percorsi. Per la prova locale usare `http://localhost:3000`; per il servizio attuale `https://real-villa.onrender.com`. È preferibile collaudare su un servizio separato prima di sostituire quello usato dalle famiglie.
- `STRIPE_SECRET_KEY`: chiave `sk_test_...` della Sandbox.
- `STRIPE_SUBSCRIPTION_PRICE_ID`: prezzo `price_...` mensile della stessa Sandbox.
- `STRIPE_EXPECTED_MONTHLY_CENTS`: 5000 significa 50 euro; deve coincidere con il prezzo Stripe. Prezzo fisso mensile, EUR, non tariffazione a consumo.
- `STRIPE_REGISTRATION_FEE_CENTS=5000`: quota unica, distinta dalla mensilità. Il sito crea le voci iniziali con gli importi verificati sul server; non occorre un secondo prezzo ricorrente per l’iscrizione.
- `SEASON_ID=2026-2027`: il calendario settembre–maggio viene calcolato da questa stagione. `SEASON_END_AT` non è più usato per le nuove iscrizioni; eliminarlo dalla configurazione per evitare confusione.
- `BILLING_POLICY=calendar_full_months_day8`: quota unica, mese d’ingresso intero e successive mensilità il giorno 8.
- L’apertura delle iscrizioni è il 1° settembre dell’anno iniziale della stagione, ora italiana. Rimuovere l’eventuale vecchio `PRESEASON_REGISTRATION_ENABLED`: non è più supportato.
- `PAYMENT_TERMS_VERSION`: identificativo delle condizioni approvate; modificarlo quando cambiano le condizioni.
- `PAYMENT_TERMS_APPROVED=true`: solo dopo l’approvazione effettiva.

La chiave pubblicabile non è necessaria a questa integrazione con Checkout ospitato. Non inserire chiavi segrete nelle pagine HTML.

### Notifiche dei pagamenti

Creare una destinazione webhook HTTPS nella stessa Sandbox:

```
https://INDIRIZZO-DEL-SITO/stripe/webhook
```

Selezionare:

```
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_succeeded
invoice.payment_failed
invoice.voided
charge.refunded
```

Copiare il segreto `whsec_...` in `STRIPE_WEBHOOK_SECRET`, salvare e distribuire la configurazione. Usare un vero checkout di prova originato dal sito per verificare le consegne. Un evento fittizio generico non rappresenta necessariamente un ordine locale.

La scadenza non è un parametro diretto del Checkout utilizzato: viene applicata alla sottoscrizione appena disponibile e verificata nel ritorno/webhook. Un’attività persistente ritenta in caso di errore. Il processo controlla ogni minuto anche i checkout incompleti o con risposta di rete incerta. Se il server è fermo, queste verifiche non girano: Stripe continua però a rispettare le scadenze già applicate. Monitorare errori webhook e contatori della segreteria; non considerare riuscita una nuova iscrizione finché la scadenza non è confermata su Stripe.

### Ricevute email

Stripe → Impostazioni → Attività → Email dei clienti: attivare «Pagamenti riusciti» ed eventualmente «Rimborsi». Verificare denominazione, contatti e personalizzazione del Real Villa. Provare l’invio della ricevuta: in Sandbox può essere necessario inviarla manualmente dal pagamento.

`STRIPE_RECEIPTS_CONFIGURED=true` si imposta solo dopo questa verifica. È un promemoria di configurazione, non un’automazione che cambia le impostazioni della Dashboard.

### Portale documenti e carta

Creare una configurazione del portale clienti Stripe con storico fatture e aggiornamento del metodo di pagamento abilitati. Disabilitare cambio piano e disdetta nel portale: la disdetta del sito applica controlli specifici sulla scadenza stagionale.

Per creare una configurazione dedicata con queste opzioni è incluso `npm run setup:portal`, da eseguire con le chiavi Sandbox. Il comando stampa l’ID `bpc_...` da impostare in `STRIPE_PORTAL_CONFIGURATION_ID`. Non modifica i pagamenti o gli abbonamenti e non sostituisce altre configurazioni. In live richiede il consenso esplicito tramite l’opzione `--live` e l’abilitazione degli incassi.

## 4. Collaudo obbligatorio PRIMA degli incassi reali

I test automatici inclusi usano Stripe e invio email simulati: non sostituiscono il collaudo della Sandbox effettiva, delle email e del servizio Render.

1. Accesso del genitore: recapito codice, scadenza, codice errato, logout e nuovo accesso.
2. Iscrizione e shop: pagamento riuscito, rifiutato e richiesta di autenticazione della carta; ritorno corretto al sito.
3. Doppi clic e interruzione della rete: una sola sottoscrizione per lo stesso tentativo/atleta; nessun secondo addebito.
4. Chiudere il browser dopo il pagamento: la notifica deve registrare l’esito e applicare la fine stagione. Controllare la scadenza sulla singola sottoscrizione Stripe.
5. Famiglia con due figli e con più profili storici: verificare tutti i documenti e la separazione degli abbonamenti. Un altro genitore non deve poter aprire quei dati.
6. Ricevuta email, storico, portale e cambio carta. Verificare documento fiscale separato con il commercialista, quando necessario.
7. Rinnovi con gli strumenti di simulazione temporale Stripe: controllare 50 euro per ogni mese previsto, la rata intera dell’8 maggio, la cancellazione all’8 giugno e l’assenza di una nuova rata di giugno. Provare ingresso il 20 settembre (100 euro), prima dell’8 (nessun doppio mese), a gennaio e a maggio (nessun abbonamento ricorrente). Non modificare l’orologio del server di produzione.
8. Esenzione: sospendere PRIMA della fattura interessata scegliendo «Void invoices», attraversare una scadenza e verificare zero incassi e nessun recupero arretrato; riprendere alla scadenza concordata. La data di ripresa non sposta da sola il giorno di fatturazione.
9. Assenza comunicata dopo l’emissione o il pagamento: verificare gestione separata di fattura esistente, rimborso o credito. Non annullare genericamente tutte le fatture di un cliente.
10. Disdetta di un solo figlio, sospensione e scadenza stagionale contemporanee: non modificare l’altro abbonamento, non estendere la durata, non riattivare un abbonamento concluso.
11. Riavvio/deploy: ordini, accessi e attività pendenti devono sopravvivere sul disco persistente. Provare backup e ripristino su una copia.

## 5. Abbonamenti precedenti e PayPal

La migrazione delle tabelle è aggiuntiva: non cancella ordini o sottoscrizioni. Le vecchie posizioni NON ricevono automaticamente la nuova data: vanno verificate e, se concordato, aggiornate individualmente su Stripe.

Le nuove iscrizioni stagionali offrono carta e PayPal tramite Stripe Checkout: importi, storico, ricevute, notifiche e scadenza sono gestiti dalla stessa integrazione Stripe. PayPal ricorrente deve essere disponibile sull’account Stripe; in live collegare l’account PayPal Business e completare le eventuali approvazioni. Gli abbonamenti PayPal DIRETTI già esistenti continuano a essere gestiti separatamente da PayPal e non vengono interrotti. La vecchia disdetta del sito con soli email e telefono è disabilitata per sicurezza.

Lo shop PayPal è conservato ma disabilitato per impostazione predefinita (`PAYPAL_CHECKOUT_ENABLED=false`). Non è coperto dai nuovi test finanziari Stripe: prima di riattivarlo eseguire il suo collaudo separato. Questa versione non afferma equivalenza delle funzionalità fra i due provider.

## 6. Pubblicazione e passaggio live

Non è stato effettuato alcun deploy né push. Conservare una copia della versione attualmente online e dell’archivio prima di sostituire i file del repository. Non sostituire la directory `.git` o il database con quelli di un altro computer.

Per il caricamento e la configurazione di prova seguire anche [SANDBOX-RENDER.md](SANDBOX-RENDER.md). Render Free non conserva il database SQLite tra riavvii/deploy: è ammesso qui solo come ambiente di prova sacrificabile, non per incassi reali o per certificare la persistenza dell’archivio. Non copiare l’intera cartella sul normale Hosting Linux Aruba: il server Node.js non è supportato da quel prodotto. È invece possibile acquistare il dominio presso Aruba e collegarlo al servizio Node.js compatibile.

Su Render: build `npm ci`, start `npm start`, Node compatibile con `package.json`; disco persistente, singola istanza e servizio che non vada in sospensione durante l’operatività dei pagamenti. La verifica `/healthz` controlla la raggiungibilità dell’app, non la correttezza dei pagamenti o il recapito delle email.

Prima del live eseguire `npm test` e `npm run check:billing`, completare la checklist Sandbox per CARTA E PAYPAL, verificare i documenti con il consulente e registrare l’approvazione del responsabile della società. Disattivare `SANDBOX_EARLY_REGISTRATION=false`. Creare/configurare poi prezzo, webhook e portale nell’ambiente LIVE, collegare e abilitare PayPal ricorrente su Stripe, sostituire tutte le credenziali coerentemente e attivare `STRIPE_MODE=live` e `LIVE_PAYMENTS_ENABLED=true`. Non riusare ID Sandbox in live. Non utilizzare Render Free per gli incassi reali con questo archivio SQLite.

In caso di problemi non eseguire una seconda iscrizione o un ripristino automatico di un vecchio database: si rischiano duplicati o dati mancanti. Conservare log e riferimenti, verificare i pagamenti su Stripe e intervenire con il responsabile.

## Fonti tecniche

- Ricevute: https://docs.stripe.com/receipts
- Portale clienti: https://docs.stripe.com/customer-management
- Fine abbonamento e riproporzionamenti: https://docs.stripe.com/billing/subscriptions/cancel
- Sospensione con annullamento delle fatture: https://docs.stripe.com/billing/subscriptions/pause-payment
- Webhook: https://docs.stripe.com/webhooks
- Fatturazione elettronica: https://support.stripe.com/questions/what-is-e-invoicing-and-how-to-do-it?locale=it-IT
- Persistenza Render: https://render.com/docs/disks
- Invio SMTP: https://nodemailer.com/smtp
- Invio email HTTPS: https://resend.com/docs/api-reference/emails/send-email
- Limiti del mittente di prova: https://resend.com/docs/knowledge-base/403-error-resend-dev-domain
- Limiti Render Free: https://render.com/docs/free
- Compatibilità hosting Aruba: https://guide.aruba.it/faq/hosting-e-domini/linguaggi-e-spazio-web-linux
