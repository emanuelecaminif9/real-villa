# Verifiche della versione — 28 agosto 2026

## Eseguite

- Controllo di sintassi di tutti i file JavaScript dell’applicazione, delle pagine, degli strumenti e dei test.
- 88 test automatici superati, nessun fallimento e nessun test saltato, con Stripe e invio email simulati.
- Carta e PayPal richiesti nello stesso Checkout Stripe, sia per abbonamenti sia per l’ingresso a maggio. Il test verifica parametri e controlli, non simula l’interfaccia esterna PayPal.
- Apertura anticipata strettamente Sandbox: 100 euro per settembre simulato, primo rinnovo 8 ottobre, consenso distinto, scadenza reale della sessione e fine stagione applicata una sola volta. Chiavi live, attivazione live o valori di sicurezza mancanti impediscono la prova; autenticazione e consenso restano obbligatori. Non riapre stagioni chiuse.
- Calendario: 50 euro d’iscrizione e 50 euro per il mese d’ingresso; esempio 20 settembre = 100 euro subito più otto rinnovi da ottobre a maggio. Verificati ingresso prima dell’8 senza doppia mensilità, tutti i mesi da settembre a maggio, cambio di mese nel fuso italiano, cambio dell’ora e chiusura delle nuove iscrizioni a fine maggio.
- Rinnovi: prima rata l’8 del mese successivo, ultima rata ordinaria l’8 maggio e chiusura tecnica l’8 giugno. Il test verifica i parametri e il calendario previsti dal codice, non la futura fattura effettivamente emessa da Stripe: serve anche il collaudo esterno.
- Ingresso a maggio: pagamento unico di 100 euro, senza abbonamento ricorrente o attività pendente inutile. In modalità normale l’apertura è il 1° settembre: prima di tale data non si creano checkout, anche con il vecchio flag di anticipo. Solo la nuova prova esplicita Sandbox consente il collaudo anticipato. Verificato il passaggio esatto della mezzanotte italiana tra agosto e settembre.
- Sicurezza e recupero: autorizzazione, appartenenza dei dati, codici monouso, limite dei tentativi, protezione delle richieste, conferme, idempotenza, errori di rete, webhook firmati, notifiche duplicate, eventi fuori ordine, riconciliazione, famiglie con più figli, sospensioni e migrazione non distruttiva dell’archivio. Importi e collegamento fra ordine, cliente e abbonamento controllati prima della conferma.
- Email: invio Resend via HTTPS simulato, errori generici senza divulgare credenziali, invalidazione del codice se l’invio fallisce, blocco del mittente di prova in live e compatibilità della precedente alternativa SMTP.
- Verifica HTTP delle pagine principali e delle nuove pagine; richieste anonime o prive di protezioni respinte; webhook non configurato non accetta eventi.
- Tutte le 19 pagine HTML: 263 riferimenti locali verificati sui sorgenti, con file presenti e maiuscole coerenti. Nessuna ispezione visiva in browser eseguita.
- Le 17 risorse originali (immagini, logo e PDF) coincidono byte per byte con la versione del repository precedente a questo aggiornamento.
- Dipendenze e lockfile invariati; riutilizzate le dipendenze locali della consegna precedente dopo aver verificato l’identità del lockfile. Nessun nuovo controllo online delle vulnerabilità effettuato in questa lavorazione.
- Pacchetto di 75 file, creato da un elenco esplicito dei sorgenti; esclusi `.env`, database, backup, `node_modules` e cronologia Git. Controllo dei pattern di credenziali senza corrispondenze e verifica dell’integrità ZIP. La scansione automatica non certifica l’assenza assoluta di qualsiasi segreto.

## Non eseguite, da completare prima del live

- Pagamento end-to-end e simulazione dei rinnovi nella Sandbox effettiva del Real Villa, con API, prezzo, account e webhook reali di test.
- Recapito Resend/SMTP reale, ricevute automatiche Stripe, verifica del dominio mittente e autenticazione del portale configurato nell’account.
- Verifica visiva e interattiva in browser su desktop e smartphone.
- Configurazione e ripristino del disco persistente Render che contiene i dati della società.
- Verifica dell’archivio esistente rispetto ai movimenti dei provider e impostazione concordata delle scadenze degli abbonamenti precedenti.
- Conferma dell’applicazione del mese intero anche agli ingressi prima dell’8; revisione legale, fiscale e privacy e approvazione formale delle condizioni prima degli incassi reali. La partenza delle iscrizioni da settembre è stata confermata dall’utente.
- Collaudo esterno carta E PayPal tramite Stripe, inclusi autorizzazione, rinnovi e annullamenti. Lo shop PayPal diretto preesistente resta distinto e disabilitato finché non viene collaudato e abilitato esplicitamente.

Non sono stati eseguiti pagamenti, rimborsi, sospensioni, creazioni di piani sul vero account o deploy durante questa lavorazione. I test automatici sono riproducibili con `npm test` e non caricano `.env` né credenziali reali.

La versione precedente resta nella cronologia Git. La cartella collegata al repository e aggiornata per questa consegna è `/Users/emanuelecaminti/Desktop/REALVILLA-render`. Non sono stati modificati database o credenziali; lo ZIP dei sorgenti non è un backup amministrativo.

I controlli locali non sostituiscono la checklist di [ATTIVAZIONE-SICURA.md](ATTIVAZIONE-SICURA.md). Per preparare la prova leggere [SANDBOX-RENDER.md](SANDBOX-RENDER.md). Non è corretto chiamare questa versione «certificata per la produzione» prima del collaudo esterno.
