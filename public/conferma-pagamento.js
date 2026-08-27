const params = new URLSearchParams(window.location.search);
const orderId = params.get("ordine") || "";
const type = params.get("tipo") === "shop" ? "shop" : "iscrizione";
const message = document.getElementById("confirmationMessage");
const next = document.getElementById("confirmationNext");
const action = document.getElementById("confirmationAction");
const formatPrice = (cents) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );

if (type === "shop") {
  message.textContent =
    "Grazie per il tuo acquisto. Abbiamo ricevuto correttamente il pagamento dell’ordine.";
  next.textContent =
    "La società ti contatterà per concordare la consegna o il ritiro dei prodotti.";
  action.href = "Shop.html";
  action.textContent = "Torna allo shop";
  localStorage.removeItem("real-villa-cart");
} else {
  message.textContent =
    "Grazie. Il pagamento e la richiesta di iscrizione sono stati registrati correttamente.";
  next.textContent =
    "La società ti contatterà per completare i passaggi amministrativi dell’iscrizione.";
}

if (orderId) document.getElementById("confirmationOrder").textContent = orderId;

async function loadConfirmation() {
  if (!orderId) return;
  try {
    const response = await fetch(
      `/api/payments/status/${encodeURIComponent(orderId)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return;
    const order = await response.json();
    if (!order.confirmed) {
      document.getElementById("confirmationTitle").textContent =
        "Pagamento in verifica.";
      message.textContent =
        "Il gestore sta ancora confermando la transazione. Non ripetere il pagamento.";
      return;
    }
    document.getElementById("confirmationAmount").textContent = formatPrice(
      order.amount,
    );
    document.getElementById("confirmationProvider").textContent =
      order.provider === "paypal" ? "PayPal" : "Carta · Stripe";
  } catch {
    // La conferma resta valida anche se il riepilogo non è momentaneamente disponibile.
  }
}

loadConfirmation();
