(() => {
  const $ = id => document.getElementById(id); let cursor;
  async function load(append = false) {
    try {
      const { account } = await RV.request('/api/account/me');
      if (!account) { $('adminStatus').replaceChildren(); const a = RV.node('a', 'Verifica l’email della segreteria', 'billing-link'); a.href = 'i-miei-pagamenti.html?return=%2Fsegreteria.html'; $('adminStatus').append(a); return; }
      if (!account.admin) throw new Error('Questa email non è autorizzata ad accedere alla segreteria.');
      const data = await RV.request('/api/admin/overview' + (append && cursor ? '?after=' + encodeURIComponent(cursor) : ''));
      $('adminPanel').hidden = false; $('adminStatus').textContent = account.email + (data.testMode ? ' · SANDBOX' : ' · Pagamenti reali');
      $('adminHealth').textContent = `Scadenze da completare: ${data.pendingTasks}. Eventi Stripe da verificare: ${data.failedEvents}. Consulta anche le consegne dei webhook nel pannello Stripe.`;
      if (!append) $('adminSubscriptions').replaceChildren();
      for (const sub of data.subscriptions) {
        const card = RV.node('section', null, 'billing-card'); card.append(RV.node('h2', sub.athlete), RV.node('small', sub.id), RV.node('span', RV.status(sub.status), 'billing-status'));
        card.append(RV.node('p', `Quota: ${RV.money(sub.amount, sub.currency)} · Fine periodo corrente: ${RV.date(sub.periodEnd)}`));
        card.append(RV.node('p', sub.cancelAt ? 'Fine programmata: ' + RV.date(sub.cancelAt) : 'Attenzione: nessuna fine programmata.', sub.cancelAt ? '' : 'billing-notice'));
        if (sub.paused) card.append(RV.node('p', `Incassi sospesi · Ripresa: ${sub.resumesAt ? RV.date(sub.resumesAt) : 'manuale'} · Trattamento fatture: ${sub.pauseBehavior}`, 'billing-notice'));
        if (['past_due', 'unpaid'].includes(sub.stripeStatus)) card.append(RV.node('p', 'Sono presenti pagamenti da verificare. Controlla anche le fatture emesse prima della sospensione.', 'billing-notice'));
        const link = RV.node('a', 'Gestisci questo abbonamento su Stripe', 'button'); link.href = sub.dashboard; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); $('adminSubscriptions').append(card);
      }
      if (!append && !data.subscriptions.length) $('adminSubscriptions').append(RV.node('p', 'Nessun abbonamento presente.'));
      cursor = data.next; $('adminMore').hidden = !cursor;
    } catch (error) { RV.error(error); $('adminStatus').textContent = 'Accesso o dati non disponibili.'; }
  }
  $('adminMore').addEventListener('click', async () => { $('adminMore').disabled = true; await load(true); $('adminMore').disabled = false; }); load();
})();
