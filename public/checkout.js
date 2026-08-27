const CHECKOUT_PRODUCTS = {
  "kit-gara": {
    name: "Kit gara",
    price: 6500,
    image: "prodotto-kit-gara.webp",
    sizes: ["XS", "S", "M", "L", "XL", "XXL"],
  },
  "kit-allenamento": {
    name: "Kit allenamento",
    price: 5500,
    image: "prodotto-kit-allenamento.webp",
    sizes: ["XS", "S", "M", "L", "XL", "XXL"],
  },
  zaino: {
    name: "Zaino",
    price: 3500,
    image: "prodotto-zaino.webp",
    sizes: ["Taglia unica"],
  },
  calzini: {
    name: "Calzini",
    price: 1200,
    image: "prodotto-calzini.webp",
    sizes: ["31-34", "35-38", "39-42", "43-46"],
  },
};

const storageKey = "real-villa-cart";
const form = document.getElementById("checkoutForm");
const submit = document.getElementById("checkoutSubmit");
const errorBox = document.getElementById("checkoutError");
const itemsBox = document.getElementById("checkoutOrderItems");
const emptyBox = document.getElementById("checkoutEmpty");
const totalsBox = document.getElementById("checkoutTotals");
const formatPrice = (cents) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );

function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => {
      const product = CHECKOUT_PRODUCTS[item.id];
      return (
        product &&
        product.sizes.includes(item.size) &&
        Number.isInteger(item.quantity) &&
        item.quantity >= 1 &&
        item.quantity <= 10
      );
    });
  } catch {
    return [];
  }
}

const cart = readCart();
const total = cart.reduce(
  (sum, item) => sum + CHECKOUT_PRODUCTS[item.id].price * item.quantity,
  0,
);

emptyBox.hidden = cart.length > 0;
totalsBox.hidden = cart.length === 0;
form.hidden = cart.length === 0;
submit.disabled = cart.length === 0;
document.getElementById("checkoutSubtotal").textContent = formatPrice(total);
document.getElementById("checkoutTotal").textContent = formatPrice(total);
document.getElementById("checkoutSubmitTotal").textContent = formatPrice(total);

cart.forEach((item) => {
  const product = CHECKOUT_PRODUCTS[item.id];
  const row = document.createElement("article");
  row.className = "checkout-order-item";
  row.innerHTML = `
    <div class="checkout-order-image">
      <img src="${product.image}" alt="" />
      <span>${item.quantity}</span>
    </div>
    <div>
      <strong>${product.name}</strong>
      <small>Taglia: ${item.size}</small>
    </div>
    <strong>${formatPrice(product.price * item.quantity)}</strong>`;
  itemsBox.appendChild(row);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  submit.disabled = true;
  const initialText = submit.innerHTML;
  submit.textContent = "Preparazione del pagamento…";

  try {
    const values = Object.fromEntries(new FormData(form).entries());
    const provider = values.provider;
    delete values.provider;
    const response = await fetch("/api/payments/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: "shop",
        provider,
        items: cart,
        customer: values,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.url)
      throw new Error(result.error || "Impossibile avviare il pagamento");
    window.location.assign(result.url);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    submit.disabled = false;
    submit.innerHTML = initialText;
    errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});
