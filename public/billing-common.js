window.RV = {
  async request(path, body) {
    const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RV-Request': '1' }, body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || 'Servizio non disponibile. Riprova più tardi.'); error.status = response.status; throw error; }
    return data;
  },
  money(cents, currency = 'eur') { return Number.isFinite(cents) ? new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(cents / 100) : 'Da verificare'; },
  date(seconds) { return seconds ? new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeZone: 'Europe/Rome' }).format(new Date(seconds * 1000)) : 'Non prevista'; },
  node(tag, text, className) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; },
  error(error, id = 'billingError') { const el = document.getElementById(id); if (el) { el.textContent = error.message; el.hidden = false; } },
  safeUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com')) ? url.href : null; } catch { return null; } },
  status(value) { return { ACTIVE: 'Attivo', SUSPENDED: 'Incassi sospesi', CANCELED: 'Concluso', EXPIRED: 'Scaduto', PAYMENT_FAILED: 'Pagamento da verificare', PENDING: 'In verifica', PAID: 'Pagato', APPROVED: 'Approvato · incasso da verificare', succeeded: 'Pagato', failed: 'Non riuscito', pending: 'In elaborazione' }[value] || 'Da verificare'; },
};
