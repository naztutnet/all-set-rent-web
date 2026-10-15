import { estimate, formatMoney, kits, products as kitProducts, rentalDays } from "./catalog.mjs?v=6";
import { inventoryCategories, inventoryProducts } from "./inventory.mjs?v=6";
import { createStorefront, detectApi, extraCategories, kitView, lineTotal, liveKits, toProduct } from "./storefront-live.mjs?v=2";
import { buildVariants, describeContext } from "./picker.mjs?v=1";

const allCategories = [...inventoryCategories, ...extraCategories];
const categoryById = new Map(allCategories.map((category) => [category.id, category]));
let catalogProducts = inventoryProducts.map((item, index) => ({
  ...item,
  categoryId: item.category,
  category: item.categoryName,
  categoryShort: categoryById.get(item.category)?.short || item.categoryName,
  unit: `${item.unit} / смена`,
  tag: item.image ? "Фото готово" : "Фото готовим",
  tone: "neutral",
  catalogIndex: index + 1,
}));
let selectableProducts = new Map([...kitProducts, ...catalogProducts].map((item) => [item.id, item]));

// Живой режим: витрина открыта с сервера склада. Каталог, цены и наличие на
// даты берутся из Бот-Склада, «Запросить подтверждение» создаёт заявку в складе.
const live = { store: null, free: {}, loading: false };

const state = {
  cart: JSON.parse(localStorage.getItem("allset-cart") || "[]"),
  category: "all",
  search: "",
  expanded: false,
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
  const visual = product.image
    ? `<img src="${product.image}" alt="" width="960" height="960" loading="lazy" decoding="async" />`
    : `<div class="product-placeholder" aria-hidden="true"><span>${String(product.catalogIndex).padStart(2, "0")}</span><small>${product.categoryShort}</small></div>`;
  const price = Number.isFinite(product.price)
    ? `<strong>${live.store ? "" : "от "}${formatMoney(product.price)}</strong><span>${product.unit}</span>`
    : `<strong class="price-request">Цена по запросу</strong><span>добавим в общую смету</span>`;
  const free = live.store ? live.free[product.id] : null;
  const stock = live.store
    ? (live.loading || free === undefined ? "проверяем даты…" : free > 0 ? `${free} свободно на даты` : "занято на эти даты")
    : `≈ ${product.stock} доступно`;
  const soldOut = live.store && free !== undefined && free <= 0;
  return `
    <article class="product-card">
      <div class="product-visual tone-${product.tone} ${product.image ? "" : "is-placeholder"}">
        <span class="product-tag">${product.tag}</span>
        ${visual}
      </div>
      <div class="product-meta"><span>${product.category}</span><span class="stock${soldOut ? " is-out" : ""}">${stock}</span></div>
      <h3>${product.name}</h3>
      <div class="product-buy">
        <div class="product-price">${price}</div>
        <button class="add-button" data-add-product="${product.id}" aria-label="Добавить ${product.name} в смету" ${soldOut ? "disabled" : ""}>+</button>
      </div>
    </article>`;
}

function renderProducts() {
  const query = state.search.trim().toLocaleLowerCase("ru");
  const filtered = catalogProducts.filter((product) => {
    const categoryMatches = state.category === "all" || product.categoryId === state.category;
    const searchMatches = !query || `${product.name} ${product.category} ${product.tag} ${(product.aliases || []).join(" ")}`.toLocaleLowerCase("ru").includes(query);
    return categoryMatches && searchMatches;
  });
  const showCompleteResult = state.expanded || state.category !== "all" || Boolean(query);
  const visible = showCompleteResult ? filtered : filtered.slice(0, 12);
  productGrid.innerHTML = visible.map(productCard).join("") || `<p class="no-results">Ничего не нашли. Попробуйте другой запрос или отправьте список супервайзеру.</p>`;
  $("[data-catalog-count]").textContent = `${filtered.length} позиций`;
  $("[data-show-all-label]").textContent = state.expanded ? "Свернуть каталог" : "Показать весь каталог";
  $("[data-show-all]").hidden = filtered.length <= 12 || state.category !== "all" || Boolean(query);
}

function renderCategoryFilters() {
  const used = new Set(catalogProducts.map((product) => product.categoryId));
  $(".category-filters").innerHTML = [
    '<button class="is-active" data-category="all">Все</button>',
    ...allCategories.filter((category) => used.has(category.id)).map((category) => `<button data-category="${category.id}">${category.short}</button>`),
  ].join("");
}

function renderLiveKits() {
  const views = liveKits.map((kit) => kitView(kit, selectableProducts, live.loading ? null : live.free)).filter(Boolean);
  $("#kits").hidden = !views.length;
  kitGrid.innerHTML = views.map((kit, index) => {
    const items = kit.rows.map((row) => `<li>${row.product.name} × ${row.qty}</li>`).join("");
    const left = kit.available === null ? "проверяем даты…" : kit.available > 0 ? `свободно комплектов: ${kit.available}` : "на эти даты не собрать";
    return `<article class="kit-card" data-code="0${index + 1}">
      <div class="kit-label"><span>${kit.label}</span><span>${left}</span></div>
      <h3>${kit.name}</h3><p>${kit.description}</p><ul class="kit-items">${items}</ul>
      <div class="kit-bottom"><div class="kit-price"><span>за сутки</span><strong>${formatMoney(kit.price)}</strong></div><button class="kit-add" data-add-kit="${kit.id}" ${kit.available === 0 ? "disabled" : ""}>Добавить комплект</button></div>
    </article>`;
  }).join("");
}

function renderKits() {
  if (live.store) {
    renderLiveKits();
    return;
  }
  kitGrid.innerHTML = kits.map((kit, index) => {
    const items = kit.itemIds.map((id, i) => {
      const product = kitProducts.find((entry) => entry.id === id);
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

function limitFor(item) {
  return live.store ? live.free[item.id] ?? 0 : item.stock;
}

function addProduct(id, quantity = 1, silent = false) {
  const product = selectableProducts.get(id);
  if (!product) return;
  const limit = limitFor(product);
  if (live.store && limit <= 0) {
    showToast(`${product.name}: на эти даты свободных нет`);
    return;
  }
  const existing = state.cart.find((item) => item.id === id);
  if (existing) existing.quantity = Math.min(limit, existing.quantity + quantity);
  else state.cart.push({ ...product, quantity: Math.min(limit, quantity) });
  saveCart();
  renderCart();
  if (!silent) showToast(`${product.name} — добавлено в смету`);
}

function addKit(id) {
  if (live.store) {
    const view = kitView(liveKits.find((entry) => entry.id === id), selectableProducts, live.free);
    if (!view || view.available <= 0) {
      showToast("На эти даты комплект не собрать");
      return;
    }
    view.rows.forEach((row) => addProduct(row.product.id, row.qty, true));
    showToast(`Комплект «${view.name}» добавлен`);
    openCart();
    return;
  }
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
  if (item.quantity > limitFor(item)) item.quantity = limitFor(item);
  saveCart();
  renderCart();
}

function renderCart() {
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  $("[data-cart-count]").textContent = count;
  $("[data-empty-cart]").classList.toggle("is-visible", !state.cart.length);
  $("[data-cart-summary]").hidden = !state.cart.length;
  $("[data-cart-items]").hidden = !state.cart.length;

  const totals = live.store ? liveTotals() : estimate(state.cart, startDate.value, endDate.value);
  $("[data-cart-items]").innerHTML = state.cart.map((item) => `
    <article class="cart-item">
      ${item.image ? `<img src="${item.image}" alt="" />` : '<div class="cart-item-placeholder" aria-hidden="true">AS</div>'}
      <div><h3>${item.name}</h3><small>${Number.isFinite(item.price) ? `${formatMoney(item.price)} / день` : "Цена после подтверждения"}</small><div class="quantity-control"><button data-quantity="-1" data-id="${item.id}" aria-label="Уменьшить количество">−</button><span>${item.quantity}</span><button data-quantity="1" data-id="${item.id}" aria-label="Увеличить количество">+</button></div></div>
      <div class="cart-item-price"><strong>${Number.isFinite(item.price) ? formatMoney(Math.round(live.store ? lineTotal(item, item.quantity, totals.days) : item.price * item.quantity * totals.days * (1 - totals.discount))) : "по запросу"}</strong><button class="remove-item" data-remove="${item.id}">Удалить</button></div>
    </article>`).join("");
  const unpricedCount = state.cart.filter((item) => !Number.isFinite(item.price)).length;
  $("[data-subtotal]").textContent = formatMoney(totals.subtotal);
  $("[data-delivery]").textContent = formatMoney(totals.delivery);
  $("[data-service]").textContent = formatMoney(totals.service);
  $("[data-discount]").textContent = totals.discount ? `−${totals.discount * 100}%` : "0%";
  $("[data-total]").textContent = `${unpricedCount ? "от " : ""}${formatMoney(totals.total)}`;
  $$("[data-estimate-extra]").forEach((row) => { row.hidden = Boolean(live.store); });
  const short = live.store ? state.cart.filter((item) => item.quantity > (live.free[item.id] ?? 0)) : [];
  if (live.store) {
    $("[data-cart-note]").textContent = short.length
      ? `На эти даты не хватает: ${short.map((item) => `${item.name} (свободно ${live.free[item.id] ?? 0})`).join(", ")}. Уменьшите количество или смените даты.`
      : "Аренда по прайсу склада за сутки включительно. Доставку, скидку за срок и итог менеджер пришлёт в смете после подтверждения.";
    $("[data-checkout]").disabled = short.length > 0;
    return;
  }
  $("[data-cart-note]").textContent = unpricedCount
    ? `${unpricedCount} поз. без утверждённой цены — менеджер добавит их в финальную смету.`
    : "Финальная стоимость — после подтверждения адреса и наличия.";
}

function liveTotals() {
  const days = rentalDays(startDate.value, endDate.value);
  const subtotal = state.cart.reduce((sum, item) => sum + lineTotal(item, item.quantity, days), 0);
  return { days, discount: 0, subtotal, delivery: 0, service: 0, total: subtotal };
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
  const totals = live.store ? liveTotals() : estimate(state.cart, startDate.value, endDate.value);
  const lines = [
    "ALL SET RENT — ПРЕДВАРИТЕЛЬНАЯ СМЕТА",
    `Период: ${formatDate(startDate.value)} — ${formatDate(endDate.value)} (${pluralDays(totals.days)})`,
    "",
    ...state.cart.map((item) => `${item.name} × ${item.quantity} — ${Number.isFinite(item.price) ? formatMoney(Math.round(live.store ? lineTotal(item, item.quantity, totals.days) : item.price * item.quantity * totals.days * (1 - totals.discount))) : "цена по запросу"}`),
    "",
    `Аренда: ${formatMoney(totals.subtotal)}`,
    ...(live.store ? ["Доставка и скидка за срок: в смете менеджера"] : [
      `Доставка: ${formatMoney(totals.delivery)}`,
      `Подготовка: ${formatMoney(totals.service)}`,
    ]),
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
    // На живом складе старый подбор из описи заменён подбором под проект.
    if (live.store) $("#picker").scrollIntoView({ behavior: "smooth" });
    else helpDialog.showModal();
  }
  if (target.matches("[data-take-variant]")) takeVariant(target.dataset.takeVariant);
  if (target.matches("[data-jump-catalog]")) {
    closeCart();
    $("#catalog").scrollIntoView({ behavior: "smooth" });
  }
  if (target.matches("[data-edit-dates]")) {
    closeCart(); startDate.focus(); startDate.showPicker?.();
  }
  if (target.matches("[data-build-kit]")) { event.preventDefault(); buildSuggestedKit(); }
  if (target.matches("[data-download]")) downloadEstimate();
  if (target.matches("[data-checkout]")) openOrder();
  if (target.matches("[data-close-order]")) orderDialog.close();
  if (target.matches("[data-category]")) {
    state.category = target.dataset.category;
    state.expanded = false;
    $$("[data-category]").forEach((button) => button.classList.toggle("is-active", button === target));
    renderProducts();
  }
  if (target.matches("[data-show-all]")) {
    state.expanded = !state.expanded;
    renderProducts();
    if (!state.expanded) $("#catalog").scrollIntoView({ behavior: "smooth" });
  }
  if (target.matches(".menu-button")) {
    const nav = $(".mobile-nav");
    nav.classList.toggle("is-open");
    target.setAttribute("aria-expanded", String(nav.classList.contains("is-open")));
  }
  if (target.closest(".mobile-nav") && target.matches("a")) $(".mobile-nav").classList.remove("is-open");
});

startDate.addEventListener("change", () => { updateDates(); refreshAvailability(); });
endDate.addEventListener("change", () => { updateDates(); refreshAvailability(); });
$("[data-search]").addEventListener("input", (event) => { state.search = event.target.value; state.expanded = false; renderProducts(); });
$("[name='crew']").addEventListener("input", (event) => { $("[data-crew-value]").textContent = `${event.target.value} человек`; });
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("[data-search]").focus(); }
  if (event.key === "Escape" && drawer.classList.contains("is-open")) closeCart();
});

// ---------------------------------------------------------------- заявка

const orderDialog = $("[data-order-dialog]");

function openOrder() {
  if (!state.cart.length) return;
  const form = $("[data-order-form]");
  $("[data-order-offline]").hidden = Boolean(live.store);
  form.hidden = !live.store;
  $("[data-order-done]").hidden = true;
  $("[data-order-error]").textContent = "";
  $("[data-order-summary]").textContent = `${formatDate(startDate.value)} → ${formatDate(endDate.value)} · ${state.cart.reduce((sum, item) => sum + item.quantity, 0)} ед. · ${state.cart.length} поз.`;
  orderDialog.showModal();
}

async function submitOrder(event) {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const button = form.querySelector("[type=submit]");
  const error = $("[data-order-error]");
  error.textContent = "";
  button.disabled = true;
  button.textContent = "Отправляем…";
  try {
    const result = await live.store.order({
      date_out: startDate.value,
      date_back: endDate.value,
      lines: state.cart.map((item) => ({ item_id: item.id, qty: item.quantity })),
      name: String(data.get("name") || ""),
      phone: String(data.get("phone") || ""),
      company: String(data.get("company") || ""),
      project: String(data.get("project") || ""),
      email: String(data.get("email") || ""),
      comment: String(data.get("comment") || ""),
      website: String(data.get("website") || ""),
    });
    form.hidden = true;
    $("[data-order-done]").hidden = false;
    $("[data-order-number]").textContent = result.request_id ? `Номер заявки: ${result.request_id}` : "";
    state.cart = [];
    saveCart();
    renderCart();
    closeCart();
    form.reset();
  } catch (failure) {
    error.textContent = failure.message;
    if (failure.status === 409) refreshAvailability();
  } finally {
    button.disabled = false;
    button.textContent = "Отправить заявку";
  }
}

$("[data-order-form]").addEventListener("submit", submitOrder);

// ---------------------------------------------------------------- подбор под проект

const picker = { input: null, variants: [] };

function pickerInput() {
  const data = new FormData($("[data-picker-form]"));
  return {
    people: Number(data.get("people")),
    location: String(data.get("location")),
    night: data.get("night") === "on",
    dateOut: startDate.value,
    dateBack: endDate.value,
  };
}

function renderPicker() {
  if (!picker.input) return;
  picker.variants = buildVariants({ ...picker.input, dateOut: startDate.value, dateBack: endDate.value }, selectableProducts, live.loading ? {} : live.free);
  $("[data-picker-context]").textContent = `Подбор для: ${describeContext(picker.variants[0].context)}, ${formatDate(startDate.value)} → ${formatDate(endDate.value)}`;
  $("[data-picker-grid]").innerHTML = picker.variants.map((variant) => `
    <article class="picker-card${variant.id === "opt" ? " is-opt" : ""}">
      <h3>${variant.name}</h3>
      <p>${variant.note}</p>
      <ul>${variant.rows.map((row) => `<li class="${row.short ? "is-short" : ""}" title="${row.why.join("; ")}"><span>${row.product.name}</span><small>× ${row.qty}${row.short ? ` · свободно ${row.free}` : ""}</small></li>`).join("")}</ul>
      ${variant.short.length ? `<p class="picker-short">На эти даты не хватает ${variant.short.length} поз. В смету положим, сколько свободно.</p>` : ""}
      <div class="picker-total"><span>за ${variant.context.shifts} ${variant.context.shifts === 1 ? "сутки" : "суток"}, по прайсу</span><strong>${formatMoney(variant.total)}</strong></div>
      <button type="button" class="checkout-button" data-take-variant="${variant.id}">Взять этот вариант <span>→</span></button>
    </article>`).join("");
}

function takeVariant(id) {
  const variant = picker.variants.find((entry) => entry.id === id);
  if (!variant) return;
  variant.rows.forEach((row) => addProduct(row.product.id, row.qty, true));
  showToast(`Вариант «${variant.name}» в смете. Проверьте и поправьте количество.`);
  openCart();
}

$("[data-picker-form]").addEventListener("submit", (event) => {
  event.preventDefault();
  picker.input = pickerInput();
  renderPicker();
  $("[data-picker-grid]").scrollIntoView({ behavior: "smooth", block: "nearest" });
});

// ---------------------------------------------------------------- живой склад

async function refreshAvailability() {
  if (!live.store) return;
  live.loading = true;
  renderProducts();
  try {
    live.free = await live.store.availability(startDate.value, endDate.value);
  } catch (failure) {
    live.free = {};
    showToast(failure.message);
  }
  live.loading = false;
  renderProducts();
  renderKits();
  renderPicker();
  renderCart();
}

async function connectWarehouse() {
  const root = await detectApi();
  if (!root) return;
  try {
    const store = createStorefront(root);
    const items = await store.catalog();
    live.store = store;
    catalogProducts = items.map((item, index) => {
      const product = toProduct(item, inventoryProducts, index);
      const category = categoryById.get(product.categoryId);
      return {
        ...product,
        category: category?.name || item.category,
        categoryShort: category?.short || item.category,
        unit: product.consumable ? `${product.unit} · разово` : `${product.unit} / сутки`,
        tag: product.image ? "В наличии на складе" : "Фото готовим",
        tone: "neutral",
      };
    });
    selectableProducts = new Map(catalogProducts.map((item) => [item.id, item]));
    // Позиции из старой корзины, которых нет на складе, честно убираем.
    state.cart = state.cart.filter((item) => selectableProducts.has(item.id)).map((item) => ({ ...selectableProducts.get(item.id), quantity: item.quantity }));
    saveCart();
    // Комплекты и подбор собраны из позиций описи, а не склада: пока их состав
    // не утверждён на реальных позициях, в живом режиме они скрыты.
    $$("[data-live-hide]").forEach((element) => { element.hidden = true; });
    $$("[data-live-only]").forEach((element) => { element.hidden = false; });
    renderKits();
    document.body.classList.add("is-live");
    renderCategoryFilters();
    await refreshAvailability();
  } catch {
    // склад не ответил: остаёмся на описи сайта
  }
}

// Просмотр из админки: сверху полоса «Так сайт видит клиент» с возвратом назад.
// Флаг держится на вкладку, чтобы полоса не пропадала при переходах по якорям.
try {
  if (new URLSearchParams(location.search).get("preview") === "client") sessionStorage.setItem("allset-preview", "client");
  if (sessionStorage.getItem("allset-preview") === "client") $("[data-preview-bar]").hidden = false;
} catch {
  if (new URLSearchParams(location.search).get("preview") === "client") $("[data-preview-bar]").hidden = false;
}

initDates();
renderCategoryFilters();
renderProducts();
renderKits();
renderCart();
connectWarehouse();
