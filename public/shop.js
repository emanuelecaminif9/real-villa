const SHOP_PRODUCTS = {
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
let cart = [];
try {
  const savedCart = JSON.parse(localStorage.getItem(storageKey) || "[]");
  if (Array.isArray(savedCart)) {
    cart = savedCart.filter((item) => {
      const product = SHOP_PRODUCTS[item.id];
      return (
        product &&
        product.sizes.includes(item.size) &&
        Number.isInteger(item.quantity) &&
        item.quantity >= 1 &&
        item.quantity <= 10
      );
    });
  }
} catch {
  localStorage.removeItem(storageKey);
}

const drawer = document.getElementById("cartDrawer");
const overlay = document.getElementById("cartOverlay");
const cartItems = document.getElementById("cartItems");
const cartEmpty = document.getElementById("cartEmpty");
const cartCount = document.getElementById("cartCount");
const cartTotal = document.getElementById("cartTotal");
const checkoutButton = document.getElementById("goToCheckout");
const formatPrice = (cents) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );

function saveCart() {
  localStorage.setItem(storageKey, JSON.stringify(cart));
  renderCart();
}

function openCart() {
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add("is-visible"));
  document.body.classList.add("cart-open");
}

function closeCart() {
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  overlay.classList.remove("is-visible");
  document.body.classList.remove("cart-open");
  setTimeout(() => {
    overlay.hidden = true;
  }, 250);
}

function renderCart() {
  cartItems.innerHTML = "";
  const quantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = cart.reduce(
    (sum, item) => sum + SHOP_PRODUCTS[item.id].price * item.quantity,
    0,
  );
  cartCount.textContent = quantity;
  cartTotal.textContent = formatPrice(total);
  cartEmpty.hidden = cart.length > 0;
  checkoutButton.setAttribute("aria-disabled", String(cart.length === 0));

  cart.forEach((item, index) => {
    const product = SHOP_PRODUCTS[item.id];
    const row = document.createElement("article");
    row.className = "cart-item";
    row.innerHTML = `
      <img src="${product.image}" alt="${product.name}">
      <div class="cart-item-copy">
        <div><strong>${product.name}</strong><button type="button" class="remove-item" aria-label="Rimuovi ${product.name}">Rimuovi</button></div>
        <span>Taglia: ${item.size}</span>
        <div class="cart-item-bottom">
          <div class="quantity-control">
            <button type="button" class="quantity-minus" aria-label="Diminuisci quantità">−</button>
            <span>${item.quantity}</span>
            <button type="button" class="quantity-plus" aria-label="Aumenta quantità">+</button>
          </div>
          <strong>${formatPrice(product.price * item.quantity)}</strong>
        </div>
      </div>`;
    row.querySelector(".remove-item").addEventListener("click", () => {
      cart.splice(index, 1);
      saveCart();
    });
    row.querySelector(".quantity-minus").addEventListener("click", () => {
      item.quantity--;
      if (item.quantity < 1) cart.splice(index, 1);
      saveCart();
    });
    row.querySelector(".quantity-plus").addEventListener("click", () => {
      if (item.quantity < 10) item.quantity++;
      saveCart();
    });
    cartItems.appendChild(row);
  });
}

document.querySelectorAll(".add-to-cart").forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".product-card");
    const id = card.dataset.productId;
    const size = card.querySelector(".product-size").value;
    const existing = cart.find((item) => item.id === id && item.size === size);
    if (existing) existing.quantity = Math.min(existing.quantity + 1, 10);
    else cart.push({ id, size, quantity: 1 });
    saveCart();
    openCart();
  });
});

document.getElementById("openCart").addEventListener("click", openCart);
document.getElementById("closeCart").addEventListener("click", closeCart);
overlay.addEventListener("click", closeCart);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeCart();
});

checkoutButton.addEventListener("click", (event) => {
  if (!cart.length) event.preventDefault();
});

renderCart();
