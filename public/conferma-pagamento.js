(() => {
  const orderId = new URLSearchParams(location.search).get('ordine');
  const $ = id => document.getElementById(id);
  let tries = 0;
  async function load() {
    if (!orderId) {
      $('confirmationTitle').textContent = 'Nessun pagamento verificabile.';
      $('confirmationMessage').textContent = 'Questa pagina da sola non dimostra un pagamento. Accedi a I miei pagamenti o contatta la segreteria.';
      return;
    }
    $('confirmationOrder').textContent = orderId;
    try {
      const response = await fetch('/api/payments/status/' + encodeURIComponent(orderId), { cache: 'no-store' });
      if (response.status === 401) throw new Error('Accedi con la tua email per verificare l’esito e scaricare le ricevute.');
      if (!response.ok) throw new Error('Esito non disponibile al momento. Non pagare di nuovo: controlla I miei pagamenti o contatta la segreteria.');
      const order = await response.json();
      if (!order.confirmed) {
        $('confirmationTitle').textContent = 'Pagamento in verifica.';
        $('confirmationMessage').textContent = 'Non abbiamo ancora una conferma dell’incasso. Non ripetere il pagamento.';
        if (++tries < 6) setTimeout(load, 5000);
        return;
      }
      $('confirmationIcon').textContent = '✓'; $('confirmationLabel').textContent = 'Pagamento ricevuto';
      $('confirmationTitle').textContent = 'Pagamento confermato.';
      $('confirmationMessage').textContent = order.setupPending ? 'Il pagamento è ricevuto. Stiamo verificando la scadenza dell’abbonamento: non effettuare un secondo pagamento.' : 'Il pagamento risulta completato. Puoi consultare il documento nell’area personale.';
      $('confirmationAmount').textContent = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(order.amount / 100);
      $('confirmationProvider').textContent = order.provider === 'stripe' ? 'Carta · Stripe' : 'PayPal';
      $('confirmationNext').textContent = order.context === 'shop' ? 'La società ti contatterà per il ritiro o la consegna.' : 'L’iscrizione sportiva richiede anche il completamento della modulistica e dei passaggi amministrativi.';
      try {
        sessionStorage.removeItem(order.context === 'shop' ? 'rv-shop-attempt' : 'rv-registration-attempt');
        if (order.context === 'shop') localStorage.removeItem('real-villa-cart');
      } catch {}
    } catch (error) {
      $('confirmationTitle').textContent = 'Verifica il tuo pagamento.'; $('confirmationMessage').textContent = error.message;
    }
  }
  load();
})();
