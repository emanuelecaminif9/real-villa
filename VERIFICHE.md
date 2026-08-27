# Verifiche della versione — 28 agosto 2026

## Eseguite

- Controllo di sintassi di tutti i file JavaScript dell’applicazione, delle pagine, degli strumenti e dei test.
- 40 test automatici, con Stripe e invio email simulati: autorizzazione, appartenenza dei dati, codici monouso, limite dei tentativi, protezione delle richieste, conferme, idempotenza, errori di rete, webhook firmati, notifiche duplicate, eventi fuori ordine, fine stagione, riconciliazione, famiglie con più figli, sospensioni e migrazione non distruttiva dell’archivio.
- Verifica HTTP delle pagine principali e delle nuove pagine; richieste anonime o prive di protezioni respinte; webhook non configurato non accetta eventi.
- Tutte le 19 pagine HTML hanno collegamenti locali a file presenti, con nomi e maiuscole coerenti.
- Le 17 risorse originali (immagini, logo e PDF) coincidono byte per byte con quelle dello ZIP ricevuto.
- Dipendenze installate dal lockfile; controllo npm al momento dell’installazione: nessuna vulnerabilità segnalata. Non è una garanzia di assenza di vulnerabilità.
- Nessun valore reale di chiavi Stripe o segreti webhook individuato nei file da consegnare; nessun `.env`, archivio dei pagamenti, backup o cronologia Git incluso nel pacchetto.

## Non eseguite, da completare prima del live

- Pagamento end-to-end e simulazione dei rinnovi nella Sandbox effettiva del Real Villa, con API, prezzo, account e webhook reali di test.
- Recapito SMTP reale, ricevute automatiche Stripe, verifica del dominio mittente e autenticazione del portale configurato nell’account.
- Verifica visiva e interattiva in browser su desktop e smartphone.
- Configurazione e ripristino del disco persistente Render che contiene i dati della società.
- Verifica dell’archivio esistente rispetto ai movimenti dei provider e impostazione concordata delle scadenze degli abbonamenti precedenti.
- Revisione legale, fiscale e privacy, approvazione della regola dei mesi parziali e delle date della stagione.
- Collaudo finanziario PayPal separato: la nuova gestione stagionale è Stripe; lo shop PayPal resta disabilitato finché non viene abilitato esplicitamente.

Non sono stati eseguiti pagamenti, rimborsi, sospensioni, creazioni di piani sul vero account o deploy durante questa lavorazione. I test automatici sono riproducibili con `npm test` e non caricano `.env` né credenziali reali.

I controlli locali non sostituiscono la checklist di [ATTIVAZIONE-SICURA.md](ATTIVAZIONE-SICURA.md). Non è corretto chiamare questa versione «certificata per la produzione» prima del collaudo esterno.
