(() => {
  const $ = id => document.getElementById(id); let challenge; let selectedCustomer; let cursor; let pendingCancel; let historyGeneration = 0;
  const returnPath = new URLSearchParams(location.search).get('return');
  const allowedReturn = ['/pagamenti.html', '/checkout.html', '/segreteria.html'].includes(returnPath) ? returnPath : null;
  const hideError = () => { $('billingError').hidden = true; };
  async function busy(button, action) { button.disabled = true; hideError(); try { await action(); } catch (e) { RV.error(e); } finally { button.disabled = false; } }
  $('emailForm').addEventListener('submit', e => { e.preventDefault(); busy(e.submitter, async () => {
    const result = await RV.request('/api/account/request-code', { email: $('loginEmail').value }); challenge = result.challenge;
    $('emailForm').hidden = true; $('codeForm').hidden = false; $('codeMessage').textContent = result.message; $('loginCode').focus();
  }); });
  $('codeForm').addEventListener('submit', e => { e.preventDefault(); busy(e.submitter, async () => {
    await RV.request('/api/account/verify-code', { challenge, code: $('loginCode').value }); $('loginCode').value = '';
    if (allowedReturn) location.assign(allowedReturn); else await load();
  }); });
  $('changeEmail').addEventListener('click', () => { $('codeForm').hidden = true; $('emailForm').hidden = false; $('loginCode').value = ''; $('loginEmail').focus(); });
  $('logout').addEventListener('click', () => busy($('logout'), async () => { await RV.request('/api/account/logout', {}); location.reload(); }));
  $('cancelBack').addEventListener('click', () => $('cancelDialog').close());
  $('cancelConfirm').addEventListener('click', () => busy($('cancelConfirm'), async () => {
    await RV.request('/api/account/subscriptions/' + encodeURIComponent(pendingCancel.id) + '/cancel', { version: pendingCancel.version, confirm: true }); $('cancelDialog').close(); await load();
  }));
  function subscriptionCard(sub) {
    const card = RV.node('article', null, 'billing-card');
    card.append(RV.node('h3', sub.athlete), RV.node('span', RV.status(sub.status), 'billing-status' + (sub.status === 'ACTIVE' ? '' : ' attention')));
    const dates = RV.node('dl', null, 'billing-meta');
    function detail(label, value) { const block = RV.node('div'); block.append(RV.node('dt', label), RV.node('dd', value)); dates.append(block); }
    detail('Quota mensile', RV.money(sub.amount, sub.currency));
    if (sub.billingPolicy === 'calendar_full_months_day8') detail('Ultima mensilità programmata', RV.date(sub.lastPaymentAt));
    detail('Chiusura dei rinnovi programmata', RV.date(sub.cancelAt));
    if (sub.paused) detail('Ripresa della riscossione', sub.resumesAt ? RV.date(sub.resumesAt) : 'Da concordare con la segreteria');
    else if (!['CANCELED', 'EXPIRED'].includes(sub.status)) detail('Fine del periodo corrente', RV.date(sub.periodEnd));
    card.append(dates);
    if (sub.setupPending) card.append(RV.node('p', 'La scadenza stagionale è in verifica. Non ripetere il pagamento.', 'billing-notice'));
    if (sub.paused) card.append(RV.node('p', sub.pauseBehavior === 'void' ? 'Le nuove mensilità generate durante questa sospensione vengono annullate.' : 'La gestione delle mensilità sospese va verificata con la segreteria.', 'billing-note'));
    if (['past_due', 'unpaid'].includes(sub.stripeStatus)) card.append(RV.node('p', 'Risultano pagamenti da verificare. Una sospensione non annulla automaticamente le fatture già emesse: contatta la segreteria.', 'billing-notice'));
    if (!sub.cancelAt && !sub.seasonEnd) card.append(RV.node('p', 'Questo abbonamento non ha una fine stagione programmata: contatta la segreteria.', 'billing-notice'));
    if (!['CANCELED', 'EXPIRED'].includes(sub.status) && sub.periodEnd) {
      const button = RV.node('button', 'Disdici i rinnovi futuri', 'billing-secondary');
      button.addEventListener('click', () => { pendingCancel = sub; $('cancelDescription').textContent = `${sub.athlete}: l’abbonamento terminerà il ${RV.date(Math.min(sub.periodEnd, sub.cancelAt || Infinity, sub.seasonEnd || Infinity))}.`; $('cancelDialog').showModal(); }); card.append(button);
    }
    return card;
  }
  async function history(customer, append = false) {
    const generation = ++historyGeneration; $('morePayments').disabled = true;
    const data = await RV.request('/api/account/history?customer=' + encodeURIComponent(customer) + (append && cursor ? '&after=' + encodeURIComponent(cursor) : ''));
    if (generation !== historyGeneration) return;
    if (!append) $('paymentRows').replaceChildren();
    for (const payment of data.payments) {
      const row = RV.node('tr'); const receiptCell = RV.node('td');
      row.append(RV.node('td', RV.date(payment.created)), RV.node('td', RV.money(payment.amount, payment.currency)), RV.node('td', payment.refunded ? `Rimborsato: ${RV.money(payment.refunded, payment.currency)}` : RV.status(payment.status)));
      const url = RV.safeUrl(payment.receipt);
      if (url && payment.status === 'succeeded') { const a = RV.node('a', 'Apri ricevuta'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; receiptCell.append(a); } else receiptCell.textContent = 'Non disponibile';
      row.append(receiptCell); $('paymentRows').append(row);
    }
    cursor = data.next; $('morePayments').hidden = !cursor; $('morePayments').disabled = false; $('historyEmpty').hidden = $('paymentRows').children.length > 0;
  }
  $('morePayments').addEventListener('click', () => busy($('morePayments'), () => history(selectedCustomer, true)));
  async function orders() {
    const data = await RV.request('/api/account/orders'); $('legacyOrders').replaceChildren();
    for (const order of data.orders) {
      const row = RV.node('article', null, 'billing-card'); row.append(RV.node('strong', order.context === 'shop' ? 'Ordine shop' : `Iscrizione${order.athlete ? ' · ' + order.athlete : ''}`), RV.node('small', order.id), RV.node('p', RV.status(order.status) + ' · ' + (order.provider === 'stripe' ? 'Stripe' : 'PayPal')));
      if (order.dueNow != null) row.append(RV.node('p', `Pagamento iniziale: ${RV.money(order.dueNow)}${order.paidMonth ? ' · comprende la mensilità ' + order.paidMonth : ''}.`));
      if (order.noFutureRenewals) row.append(RV.node('p', 'Ultimo mese della stagione: nessun rinnovo futuro.', 'billing-note'));
      if (order.provider === 'stripe' && order.status === 'PAID') {
        const button = RV.node('button', 'Apri il documento del pagamento', 'billing-secondary');
        button.addEventListener('click', () => busy(button, async () => { const result = await RV.request('/api/account/orders/' + encodeURIComponent(order.id) + '/receipt'); const url = RV.safeUrl(result.url); if (url) location.assign(url); })); row.append(button);
      }
      $('legacyOrders').append(row);
    }
    if (!data.orders.length) $('legacyOrders').append(RV.node('p', 'Nessun ordine associato a questa email.'));
    if (data.truncated) $('legacyOrders').append(RV.node('p', 'Sono mostrati gli ultimi 100 ordini. Per i precedenti contatta la segreteria.'));
  }
  async function load() {
    $('billingLoading').hidden = false;
    try {
      const { account, available } = await RV.request('/api/account/me');
      $('loginPanel').hidden = !!account; $('accountPanel').hidden = !account;
      if (!available) throw new Error('L’area pagamenti non è ancora attiva. Contatta la segreteria.');
      if (!account) return;
      $('accountEmail').textContent = account.email; $('adminLink').hidden = !account.admin;
      const overview = await RV.request('/api/account/overview'); $('testNotice').hidden = !overview.testMode;
      $('subscriptions').replaceChildren(); $('profiles').replaceChildren(); $('paymentRows').replaceChildren();
      for (const profile of overview.profiles) for (const sub of profile.subscriptions) $('subscriptions').append(subscriptionCard(sub));
      if (!$('subscriptions').children.length) $('subscriptions').append(RV.node('p', 'Nessun abbonamento ricorrente associato a questa email. Le iscrizioni effettuate nell’ultimo mese restano visibili negli ordini e nelle ricevute, senza rinnovi futuri.'));
      if (overview.profiles.length) {
        const select = RV.node('select'); select.setAttribute('aria-label', 'Profilo pagamenti');
        overview.profiles.forEach((p, index) => { const option = RV.node('option', overview.profiles.length > 1 ? `Profilo ${index + 1} · ${p.subscriptions.length} abbonamenti` : 'Pagamenti della famiglia'); option.value = p.id; select.append(option); });
        selectedCustomer = overview.profiles[0].id; select.addEventListener('change', () => { selectedCustomer = select.value; cursor = null; history(selectedCustomer).catch(RV.error); });
        if (overview.profiles.length > 1) $('profiles').append(RV.node('p', 'La tua email ha più profili storici Stripe. Puoi consultarli tutti senza unire o modificare i vecchi pagamenti.'));
        const portal = RV.node('button', 'Documenti e metodo di pagamento', 'billing-secondary');
        portal.addEventListener('click', () => busy(portal, async () => { const result = await RV.request('/api/account/portal', { customer: selectedCustomer }); const url = RV.safeUrl(result.url); if (url) location.assign(url); }));
        $('profiles').append(select, portal); await history(selectedCustomer);
      } else $('historyEmpty').hidden = false;
      await orders();
    } catch (e) { RV.error(e); } finally { $('billingLoading').hidden = true; }
  }
  load();
})();
