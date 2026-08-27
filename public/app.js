const mainMenu = document.querySelector('.menu ul');
if (mainMenu && !mainMenu.querySelector('a[href="i-miei-pagamenti.html"]')) {
  const item = document.createElement('li'); const link = document.createElement('a');
  link.href = 'i-miei-pagamenti.html'; link.textContent = 'I miei pagamenti'; item.append(link); mainMenu.append(item);
}
const toggle = document.querySelector(".hamburger");
const closeMenu = () => {
  document.body.classList.remove("menu-open");
  if (toggle) {
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Apri menu");
  }
};
if (toggle) {
  toggle.setAttribute("aria-expanded", "false");
  toggle.addEventListener("click", () => {
    const isOpen = document.body.classList.toggle("menu-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.setAttribute("aria-label", isOpen ? "Chiudi menu" : "Apri menu");
  });
}
document
  .querySelectorAll(".menu a")
  .forEach((a) => a.addEventListener("click", closeMenu));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});
const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
document.querySelectorAll(".menu a").forEach((a) => {
  if ((a.getAttribute("href") || "").toLowerCase() === page)
    a.classList.add("active");
});
document.querySelectorAll("a[href]").forEach((link) =>
  link.addEventListener("click", (e) => {
    const href = link.getAttribute("href");
    if (link.getAttribute("aria-disabled") === "true") {
      e.preventDefault();
      return;
    }
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("https:") ||
      link.target === "_blank"
    )
      return;
    e.preventDefault();
    document.body.classList.add("is-transitioning");
    setTimeout(() => (location.href = href), 260);
  }),
);
function resetPageTransition() {
  document.body.classList.remove("is-transitioning");
  document.body.classList.remove("menu-open");
}

window.addEventListener("pageshow", resetPageTransition);
window.addEventListener("popstate", resetPageTransition);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    resetPageTransition();
  }
});
