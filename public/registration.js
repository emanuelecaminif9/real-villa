(() => {
  const form = document.getElementById('iscrizioneForm'); const button = document.getElementById('registrationSubmit');
  const errorBox = document.getElementById('registrationError'); let config; let requestKey;
  const storedKey = 'rv-registration-attempt';
  try { requestKey = sessionStorage.getItem(storedKey); } catch {}
  if (!requestKey) { requestKey = crypto.randomUUID(); try { sessionStorage.setItem(storedKey, requestKey); } catch {} }
  const category = new URLSearchParams(location.search).get('categoria');
  if (['piccoli-campioni','primi-calci','dal-2017'].includes(category)) form.elements.pacchetto.value = category;
  const showError = error => { errorBox.textContent = error.message; errorBox.hidden = false; };
  async function init() {
    try {
      const { account } = await RV.request('/api/account/me');
      const access = document.getElementById('registrationAccess'); access.replaceChildren();
      if (!account) {
        const link = RV.node('a', 'Verifica la tua email per iscriverti', 'billing-link'); link.href = 'i-miei-pagamenti.html?return=%2Fpagamenti.html'; access.append(link);
        button.textContent = 'Accedi prima di procedere';
      } else { access.textContent = 'Accesso verificato: ' + account.email; form.elements.email.value = account.email; form.elements.email.readOnly = true; }
      config = await RV.request('/api/billing/config');
      document.getElementById('monthlyAmount').textContent = RV.money(config.amount);
      document.getElementById('seasonEnd').textContent = RV.date(config.end);
      document.getElementById('registrationConfig').textContent = `${config.testMode ? 'PROVA SANDBOX · Nessun denaro reale. ' : ''}${RV.money(config.amount)} alla sottoscrizione, poi ogni mese nello stesso giorno (o nell’ultimo giorno del mese quando necessario). Fine stagione: ${RV.date(config.end)}. L’ultimo periodo può avere un importo proporzionale alla sua durata. Nessun rinnovo oltre la scadenza prevista.`;
      if (account && config.accessAvailable) { button.disabled = false; button.textContent = 'Conferma e paga con Stripe'; }
    } catch (error) { document.getElementById('registrationConfig').textContent = error.message; button.textContent = 'Iscrizioni online non disponibili'; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!config || button.disabled) return; button.disabled = true; errorBox.hidden = true; button.textContent = 'Preparazione del pagamento…';
    try {
      const data = Object.fromEntries(new FormData(form)); delete data.provider;
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([data, config.consentVersion]))))).map(b => b.toString(16).padStart(2, '0')).join('');
      const dataKey = storedKey + ':' + fingerprint;
      try { requestKey = sessionStorage.getItem(dataKey) || crypto.randomUUID(); sessionStorage.setItem(dataKey, requestKey); } catch { requestKey ||= crypto.randomUUID(); }
      const result = await RV.request('/api/payments/start', { context: 'registration', provider: 'stripe', registration: data, requestKey, accepted: document.getElementById('paymentConsent').checked, consentVersion: config.consentVersion });
      const url = new URL(result.url, location.origin);
      if (url.origin !== location.origin && !RV.safeUrl(url.href)) throw new Error('Indirizzo di pagamento non valido. Contatta la segreteria.');
      location.assign(url.href);
    } catch (error) {
      showError(error);
      if (error.status === 410) { requestKey = crypto.randomUUID(); try { sessionStorage.setItem(storedKey, requestKey); } catch {} }
      button.disabled = false; button.textContent = 'Conferma e paga con Stripe';
    }
  });
  init();
})();
