RV.request('/api/billing/config').then(config => {
  document.getElementById('termsConfig').textContent = `Stagione ${config.id} · Iscrizione una tantum ${RV.money(config.registrationAmount)} · Mensilità ${RV.money(config.amount)} · Addebiti il giorno 8 · Ultima mensilità ${RV.date(config.lastPaymentAt)} · Versione condizioni ${config.version}${config.testMode ? ' · Ambiente di prova, nessun addebito reale.' : ''}`;
  if (config.sandboxCalendarPreview) document.getElementById('termsConfig').textContent += ' Collaudo anticipato: ingresso a settembre simulato, non apertura delle iscrizioni reali.';
}).catch(error => { document.getElementById('termsConfig').textContent = 'Iscrizioni online non disponibili. ' + error.message; });
