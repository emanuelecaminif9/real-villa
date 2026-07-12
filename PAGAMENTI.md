# Configurazione pagamenti Real Villa

Il progetto utilizza esclusivamente PayPal e Nexi XPay.

## Flusso iscrizione

- 50 € pagati immediatamente come prima iscrizione.
- Un mese senza ulteriore addebito.
- Dal mese successivo, 50 € ogni mese fino alla disdetta.

## PayPal

1. Crea un account PayPal Business e un’app nel Developer Dashboard.
2. Copia `.env.example` in `.env` e inserisci Client ID e Client Secret.
3. Esegui `npm run setup:paypal` una sola volta.
4. Copia nel file `.env` il `PAYPAL_SUBSCRIPTION_PLAN_ID` mostrato nel terminale.
5. Esegui prima i test con `PAYPAL_MODE=sandbox`; usa `live` solo con credenziali reali.

## Nexi XPay

1. Attiva un contratto Nexi XPay abilitato ai pagamenti ricorrenti `MIT_SCHEDULED`.
2. Inserisci la `NEXI_API_KEY` nel file `.env`.
3. Usa `NEXI_MODE=sandbox` per i test e `live` in produzione.
4. Il server deve restare attivo e la cartella contenente `payments.db` deve essere persistente, perché gli addebiti mensili Nexi vengono avviati dal server.

## Produzione

Imposta `BASE_URL` con il dominio HTTPS definitivo, senza slash finale. Non pubblicare mai `.env`, Client Secret o API Key.
