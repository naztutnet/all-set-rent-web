import { estimate, formatMoney, kits, products, rentalDays } from "./catalog.mjs";

const state = {
  cart: JSON.parse(localStorage.getItem("allset-cart") || "[]"),
  category: "Все",
  search: "",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const productGrid = $("[data-product-grid]");
const kitGrid = $("[data-kit-grid]");
const startDate = $("#start-date");
const endDate = $("#end-date");
const drawer = $(".cart-drawer");
const overlay = $("[data-overlay]");
const helpDialog = $("[data-help-dialog]");
let toastTimer;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function initDates() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const returnDay = new Date(tomorrow);
  returnDay.setDate(returnDay.getDate() + 2);
  startDate.min = isoDate(new Date());
  endDate.min = isoDate(tomorrow);
  startDate.value = isoDate(tomorrow);
  endDate.value = isoDate(returnDay);
  updateDates();
}

function pluralDays(days) {
  const mod10 = days % 10;
  const mod100 = days % 100;
  if (mod10 === 1 && mod100 !== 11) return `${days} день`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${days} дня`;
  return `${days} дней`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));
}

function updateDates() {
  if (endDate.value < startDate.value) endDate.value = startDate.value;
  endDate.min = startDate.value;
  const days = rentalDays(startDate.value, endDate.value);
  $("[data-days-label]").textContent = pluralDays(days);
  $("[data-drawer-dates]").textContent = `${formatDate(startDate.value)} → ${formatDate(endDate.value)} · ${pluralDays(days)}`;
  renderCart();
}

function productCard(product) {
  return `
    <article class="product-card">
      <div class="product-visual tone-${product.tone}">
        <span class="product-tag">${product.tag}</span>
        <img src="${product.image}" alt="" width="960" height="960" loading="lazy" decoding="async" />
      </div>
      <div class="product-meta"><span>${product.category}</span><span class="stock">${product.stock} доступно</span></div>
      <h3>${product.name}</h3>
      <div class="product-buy">
        <div class="product-price"><strong>от ${formatMoney(product.price)}</strong><span>${product.unit}</span></div>
        <button class="add-button" data-add-product="${product.id}" aria-label="Добавить ${product.name} в смету">+</button>
      </div>
    </article>`;
}

function renderProducts() {
  const query = state.search.trim().toLocaleLowerCase("ru");
  const filtered = products.filter((product) => {
    const categoryMatches = state.category === "Все" || product.category === state.category;
    const searchMatches = !query || `${product.name} ${product.category} ${product.tag}`.toLocaleLowerCase("ru").includes(query);
    return categoryMatches && searchMatches;
  });
  productGrid.innerHTML = filtered.map(productCard).join("") || `<p class="no-results">Ничего не нашли. Попробуйте другой запрос или отправьте список супервайзеру.</p>`;
  $("[data-catalog-count]").textContent = `${filtered.length} позиций`;
}

function renderKits() {
  kitGrid.innerHTML = kits.map((kit, index) => {
    const items = kit.itemIds.map((id, i) => {
      const product = products.find((entry) => entry.id === id);
      return `<li>${product.name} × ${kit.quantities[i]}</li>`;
    }).join("");
    return `<article class="kit-card ${kit.accent}" data-code="0${index + 1}">
      <div class="kit-label"><span>${kit.label}</span><span>0${index + 1} / 03</span></div>
      <h3>${kit.name}</h3><p>${kit.description}</p><ul class="kit-items">${items}</ul>
      <div class="kit-bottom"><div class="kit-price"><span>готовый комплект</span><strong>от ${formatMoney(kit.price)}</strong></div><button class="kit-add" data-add-kit="${kit.id}">Добавить комплект</button></div>
    </article>`;
  }).join("");
}

function saveCart() {
  localStorage.setItem("allset-cart", JSON.stringify(state.cart));
}

function addProduct(id, quantity = 1, silent = false) {
  const product = products.find((entry) => entry.id === id);
  const existing = state.cart.find((item) => item.id === id);
  if (existing) existing.quantity = Math.min(product.stock, existing.quantity + quantity);
  else state.cart.push({ ...product, quantity: Math.min(product.stock, quantity) });
  saveCart();
  renderCart();
  if (!silent) showToast(`${product.name} — добавлено в смету`);
}

function addKit(id) {
  const kit = kits.find((entry) => entry.id === id);
  kit.itemIds.forEach((productId, index) => addProduct(productId, kit.quantities[index], true));
  showToast(`Комплект «${kit.name}» добавлен`);
  openCart();
}

function changeQuantity(id, direction) {
  const item = state.cart.find((entry) => entry.id === id);
  if (!item) return;
  item.quantity += direction;
  if (item.quantity <= 0) state.cart = state.cart.filter((entry) => entry.id !== id);
  if (item.quantity > item.stock) item.quantity = item.stock;
  saveCart();
  renderCart();
}

function renderCart() {
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  $("[data-cart-count]").textContent = count;
  $("[data-empty-cart]").classList.toggle("is-visible", !state.cart.length);
  $("[data-cart-summary]").hidden = !state.cart.length;
  $("[data-cart-items]").hidden = !state.cart.length;

  const totals = estimate(state.cart, startDate.value, endDate.value);
  $("[data-cart-items]").innerHTML = state.cart.map((item) => `
    <article class="cart-item">
      <img src="${item.image}" alt="" />
      <div><h3>${item.name}</h3><small>${formatMoney(item.price)} / день</small><div class="quantity-control"><button data-quantity="-1" data-id="${item.id}" aria-label="Уменьшить количество">−</button><span>${item.quantity}</span><button data-quantity="1" data-id="${item.id}" aria-label="Увеличить количество">+</button></div></div>
      <div class="cart-item-price"><strong>${formatMoney(Math.round(item.price * item.quantity * totals.days * (1 - totals.discount)))}</strong><button class="remove-item" data-remove="${item.id}">Удалить</button></div>
    </article>`).join("");
  $("[data-subtotal]").textContent = formatMoney(totals.subtotal);
  $("[data-delivery]").textContent = formatMoney(totals.delivery);
  $("[data-service]").textContent = formatMoney(totals.service);
  $("[data-discount]").textContent = totals.discount ? `−${totals.discount * 100}%` : "0%";
  $("[data-total]").textContent = formatMoney(totals.total);
}

function openCart() {
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  overlay.classList.add("is-visible");
  document.body.classList.add("is-locked");
  $("[data-close-cart]").focus();
}

function closeCart() {
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  overlay.classList.remove("is-visible");
  document.body.classList.remove("is-locked");
}

function showToast(message) {
  const toast = $("[data-toast]");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

function buildSuggestedKit() {
  const form = helpDialog.querySelector("form");
  const crew = Number(new FormData(form).get("crew"));
  const conditions = new FormData(form).getAll("condition");
  addProduct("chair-director", Math.max(4, Math.ceil(crew / 8)), true);
  addProduct("table-folding", Math.max(2, Math.ceil(crew / 10)), true);
  addProduct("radio-motorola", Math.max(6, Math.ceil(crew / 4)), true);
  addProduct("tent-3x6", Math.max(1, Math.ceil(crew / 30)), true);
  if (conditions.includes("cold")) addProduct("heater-diesel", Math.max(1, Math.ceil(crew / 40)), true);
  if (conditions.includes("night")) addProduct("power-station", 1, true);
  if (conditions.includes("makeup")) {
    addProduct("makeup-mirror", Math.max(2, Math.ceil(crew / 10)), true);
    addProduct("rack-costume", 2, true);
  }
  helpDialog.close();
  showToast("Стартовый комплект собран — проверьте смету");
  openCart();
}

function downloadEstimate() {
  const totals = estimate(state.cart, startDate.value, endDate.value);
  const lines = [
    "ALL SET RENT — ПРЕДВАРИТЕЛЬНАЯ СМЕТА",
    `Период: ${formatDate(startDate.value)} — ${formatDate(endDate.value)} (${pluralDays(totals.days)})`,
    "",
    ...state.cart.map((item) => `${item.name} × ${item.quantity} — ${formatMoney(Math.round(item.price * item.quantity * totals.days * (1 - totals.discount)))}`),
    "",
    `Аренда: ${formatMoney(totals.subtotal)}`,
    `Доставка: ${formatMoney(totals.delivery)}`,
    `Подготовка: ${formatMoney(totals.service)}`,
    `ИТОГО: ${formatMoney(totals.total)}`,
    "",
    "Финальная стоимость подтверждается после проверки адреса и наличия.",
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `all-set-rent-${startDate.value}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Смета скачана");
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.matches("[data-add-product]")) addProduct(target.dataset.addProduct);
  if (target.matches("[data-add-kit]")) addKit(target.dataset.addKit);
  if (target.matches("[data-open-cart]")) openCart();
  if (target.matches("[data-close-cart], [data-overlay]")) closeCart();
  if (target.matches("[data-quantity]")) changeQuantity(target.dataset.id, Number(target.dataset.quantity));
  if (target.matches("[data-remove]")) {
    state.cart = state.cart.filter((item) => item.id !== target.dataset.remove);
    saveCart(); renderCart();
  }
  if (target.matches("[data-open-help]")) {
    $(".mobile-nav").classList.remove("is-open");
    helpDialog.showModal();
  }
  if (target.matches("[data-jump-catalog]")) {
    closeCart();
    $("#catalog").scrollIntoView({ behavior: "smooth" });
  }
  if (target.matches("[data-edit-dates]")) {
    closeCart(); startDate.focus(); startDate.showPicker?.();
  }
  if (target.matches("[data-build-kit]")) { event.preventDefault(); buildSuggestedKit(); }
  if (target.matches("[data-download]")) downloadEstimate();
  if (target.matches("[data-checkout]")) showToast("Заявка сохранена. Менеджер подтвердит наличие за 15 минут.");
  if (target.matches("[data-category]")) {
    state.category = target.dataset.category;
    $$("[data-category]").forEach((button) => button.classList.toggle("is-active", button === target));
    renderProducts();
  }
  if (target.matches("[data-show-all]")) {
    state.category = "Все"; state.search = ""; $("[data-search]").value = "";
    $$("[data-category]").forEach((button) => button.classList.toggle("is-active", button.dataset.category === "Все"));
    renderProducts();
  }
  if (target.matches(".menu-button")) {
    const nav = $(".mobile-nav");
    nav.classList.toggle("is-open");
    target.setAttribute("aria-expanded", String(nav.classList.contains("is-open")));
  }
  if (target.closest(".mobile-nav") && target.matches("a")) $(".mobile-nav").classList.remove("is-open");
});

startDate.addEventListener("change", updateDates);
endDate.addEventListener("change", updateDates);
$("[data-search]").addEventListener("input", (event) => { state.search = event.target.value; renderProducts(); });
$("[name='crew']").addEventListener("input", (event) => { $("[data-crew-value]").textContent = `${event.target.value} человек`; });
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("[data-search]").focus(); }
  if (event.key === "Escape" && drawer.classList.contains("is-open")) closeCart();
});

initDates();
renderProducts();
renderKits();
renderCart();
