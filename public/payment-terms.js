RV.request('/api/billing/config').then(config => {
  document.getElementById('termsConfig').textContent = `Stagione ${config.id} · Mensilità ${RV.money(config.amount)} · Fine stagione ${RV.date(config.end)} · Versione condizioni ${config.version}${config.testMode ? ' · Ambiente di prova, nessun addebito reale.' : ''}`;
}).catch(error => { document.getElementById('termsConfig').textContent = 'Le iscrizioni non sono attive finché la società non conferma le condizioni economiche e le date. ' + error.message; });
