import { loadAdminCatalog } from "./api-client.mjs";
import { inventoryCategories } from "./inventory.mjs";

const state = { items: [], query: "", category: "all", status: "all" };
const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("ru-RU");

function matches(item) {
  const text = `${item.name} ${item.categoryName || ""} ${(item.aliases || []).join(" ")}`.toLocaleLowerCase("ru");
  const queryMatch = !state.query || text.includes(state.query);
  const categoryMatch = state.category === "all" || item.category === state.category;
  const statusMatch = state.status === "all"
    || (state.status === "published" && item.published)
    || (state.status === "draft" && !item.published)
    || (state.status === "photo" && !item.image);
  return queryMatch && categoryMatch && statusMatch;
}

function statusLabel(item) {
  if (item.published) return '<span class="status status--ok"><i></i>На сайте</span>';
  if (!item.image) return '<span class="status status--photo"><i></i>Нужно фото</span>';
  return '<span class="status"><i></i>Черновик</span>';
}

function productRow(item) {
  const image = item.image
    ? `<img src="${item.image}" alt="" loading="lazy" decoding="async" />`
    : `<span>${item.name.slice(0, 1)}</span>`;
  const price = item.price == null ? "Не задана" : `${money.format(item.price)} ₽`;
  const stock = item.stock == null ? "—" : `${item.stockEstimated ? "≈ " : ""}${money.format(item.stock)}`;
  return `<article class="inventory-row" data-item-id="${item.id}">
    <div class="inventory-product">
      <div class="inventory-thumb ${item.image ? "has-image" : ""}">${image}</div>
      <div><strong>${item.name}</strong><small>${item.id}</small></div>
    </div>
    <span class="inventory-category">${item.categoryName}</span>
    <span class="inventory-value"><small>Цена</small>${price}</span>
    <span class="inventory-value inventory-stock" title="${item.stockEstimated ? "Предварительная оценка — заменим фактическим остатком" : "Фактический остаток"}"><small>Остаток</small>${stock}${item.stockEstimated ? "<em>оценка</em>" : ""}</span>
    ${statusLabel(item)}
    <button class="row-action" type="button" data-preview="${item.id}" aria-label="Открыть ${item.name}">→</button>
  </article>`;
}

function render() {
  const visible = state.items.filter(matches);
  $("[data-admin-catalog]").innerHTML = visible.map(productRow).join("")
    || '<div class="admin-empty"><strong>Ничего не найдено</strong><span>Измените запрос или фильтры.</span></div>';
  $("[data-result-count]").textContent = `${visible.length} из ${state.items.length}`;
}

function renderStats() {
  const published = state.items.filter((item) => item.published).length;
  const withPhoto = state.items.filter((item) => item.image).length;
  const values = {
    total: state.items.length,
    categories: new Set(state.items.map((item) => item.category)).size,
    published,
    photos: withPhoto,
  };
  Object.entries(values).forEach(([key, value]) => {
    const node = document.querySelector(`[data-stat="${key}"]`);
    if (node) node.textContent = value;
  });
  $("[data-photo-progress]").style.setProperty("--progress", `${Math.round((withPhoto / Math.max(1, state.items.length)) * 100)}%`);
}

function initFilters() {
  const select = $("[data-category-select]");
  select.insertAdjacentHTML("beforeend", inventoryCategories.map((category) => `<option value="${category.id}">${category.name}</option>`).join(""));
  $("[data-admin-search]").addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLocaleLowerCase("ru");
    render();
  });
  select.addEventListener("change", (event) => { state.category = event.target.value; render(); });
  document.addEventListener("click", (event) => {
    const filter = event.target.closest("[data-status]");
    if (filter) {
      state.status = filter.dataset.status;
      document.querySelectorAll("[data-status]").forEach((button) => button.classList.toggle("is-active", button === filter));
      render();
    }
    const preview = event.target.closest("[data-preview]");
    if (preview) {
      const item = state.items.find((entry) => entry.id === preview.dataset.preview);
      $("[data-toast]").textContent = `«${item.name}»: редактирование включится после подключения защищённого API.`;
      $("[data-toast]").classList.add("is-visible");
      setTimeout(() => $("[data-toast]").classList.remove("is-visible"), 3200);
    }
  });
}

async function init() {
  initFilters();
  const result = await loadAdminCatalog();
  state.items = result.items;
  const mode = $("[data-admin-mode]");
  mode.dataset.mode = result.mode;
  mode.querySelector("strong").textContent = result.mode === "live" ? "Подключено" : "Демо-режим";
  mode.querySelector("span").textContent = result.message;
  renderStats();
  render();
}

init();
