import {
  ApiError, createClient, createDemoClient, debt, filterRequests, formatDate, formatMoney,
  formatPeriod, statusTone, summarize,
} from "./warehouse-api.mjs?v=1";

const tg = window.Telegram?.WebApp;
const $ = (selector) => document.querySelector(selector);

const state = { client: null, requests: [], scope: "open", query: "" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function readApiRoot() {
  const configured = document.querySelector('meta[name="allset-api"]')?.content?.trim();
  if (configured) return configured;
  try {
    return localStorage.getItem("allset-api-root")?.trim() || "";
  } catch {
    return "";
  }
}

function setMode(mode, text) {
  const box = $("[data-mode]");
  box.dataset.mode = mode;
  $("[data-mode-text]").textContent = text;
}

function chip(status) {
  return `<span class="ma-chip ma-chip--${statusTone(status)}"><i></i>${escapeHtml(status)}</span>`;
}

// ---------------------------------------------------------------- список

function renderStats() {
  const stats = summarize(state.requests);
  for (const [key, value] of Object.entries(stats)) {
    const cell = document.querySelector(`[data-stat="${key}"]`);
    if (cell) cell.textContent = value;
  }
}

function requestRow(request) {
  const left = debt(request);
  const flags = [];
  if (request.to_issue > 0 && request.status !== "черновик") flags.push(`<span class="ma-chip ma-chip--accent">к выдаче ${request.to_issue}</span>`);
  if (request.on_hand > 0) flags.push(`<span class="ma-chip">на руках ${request.on_hand}</span>`);
  if (request.lost_open > 0) flags.push(`<span class="ma-chip ma-chip--warn">утрата ${request.lost_open}</span>`);
  return `
    <button type="button" class="ma-req" data-open="${escapeHtml(request.id)}">
      <div class="ma-req-top"><span class="ma-req-id">${escapeHtml(request.id)}</span>${chip(request.status)}</div>
      <h2>${escapeHtml(request.project || "Без проекта")}</h2>
      <div class="ma-req-sum">${formatMoney(request.payable)}${left > 0 && request.status !== "черновик" ? `<small>долг ${formatMoney(left)}</small>` : ""}</div>
      <div class="ma-req-meta">${escapeHtml(formatPeriod(request))} · ${request.positions} поз. · ${escapeHtml(request.recipient || "")}</div>
      ${flags.length ? `<div class="ma-req-flags">${flags.join("")}</div>` : ""}
    </button>`;
}

function renderList() {
  const rows = filterRequests(state.requests, { scope: state.scope, query: state.query });
  const list = $("[data-list]");
  if (!rows.length) {
    list.innerHTML = state.query
      ? `<div class="ma-empty"><strong>Ничего не найдено</strong><span>Проверьте номер или название проекта</span></div>`
      : `<div class="ma-empty"><strong>Открытых заявок нет</strong><span>Новые заявки оформляются в боте</span></div>`;
    return;
  }
  list.innerHTML = rows.map(requestRow).join("");
}

// ---------------------------------------------------------------- карточка

function fact(label, value) {
  return value ? `<div><dt>${label}</dt><dd>${value}</dd></div>` : "";
}

function lineHtml(line) {
  const consumable = line.kind === "расходник";
  const nums = consumable
    ? [["Согласовано", line.qty], ["Выдано", line.issued], ["Осталось выдать", line.to_issue, line.to_issue > 0], ["", ""]]
    : [["Согласовано", line.qty], ["Выдано", line.issued], ["На руках", line.on_hand, line.on_hand > 0], ["Вернули", line.returned]];
  const cells = nums
    .filter(([label]) => label)
    .map(([label, value, alert]) => `<div class="${alert ? "is-alert" : ""}"><span>${label}</span><b>${value}</b></div>`)
    .join("");
  const extra = [];
  if (line.lost_open > 0) extra.push(`<span class="ma-chip ma-chip--warn">утрата ${line.lost_open}, ждёт решения</span>`);
  if (line.mode === "расходник в подарок") extra.push(`<span class="ma-chip">в подарок</span>`);
  const price = consumable
    ? `${formatMoney(line.price_per_day)} × ${line.qty} ${escapeHtml(line.unit)}`
    : `${formatMoney(line.price_per_day)} / сут × ${line.days} сут`;
  return `
    <article class="ma-line">
      <div class="ma-line-head"><strong>${escapeHtml(line.name)}</strong><span>${escapeHtml(line.item_id)}</span></div>
      <div class="ma-line-nums" style="grid-template-columns:repeat(${consumable ? 3 : 4},1fr)">${cells}</div>
      <div class="ma-line-foot"><span>${price}</span><b>${formatMoney(line.amount)}</b></div>
      ${extra.length ? `<div class="ma-req-flags">${extra.join("")}</div>` : ""}
    </article>`;
}

function moneyHtml(request) {
  const money = request.money || {};
  const left = debt(request);
  const rows = [];
  if (!request.priced) {
    rows.push(["По прайсу сейчас", formatMoney(money.price_total)]);
    return `<dl class="ma-money">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      <p class="ma-eyebrow" style="margin-top:8px;letter-spacing:.04em;text-transform:none;font-size:11px">Итог зафиксируется при согласовании.</p>`;
  }
  rows.push(["По прайсу", formatMoney(money.price_total)]);
  if (Number(money.discount) > 0) rows.push(["Скидка", `${Number(money.discount)} %`]);
  if (Number(money.fixed) > 0) rows.push(["Фиксированная цена", formatMoney(money.fixed)]);
  if (Number(money.tax_rate) > 0) rows.push(["Налог", `${Number(money.tax_rate)} %`]);
  const body = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  return `<dl class="ma-money">
      ${body}
      <div class="is-total"><dt>К оплате</dt><dd>${formatMoney(money.payable)}</dd></div>
      <div><dt>Оплачено</dt><dd>${formatMoney(money.paid)}</dd></div>
      ${left > 0 ? `<div class="is-debt"><dt>Осталось${money.pay_due ? ` до ${escapeHtml(formatDate(money.pay_due))}` : ""}</dt><dd>${formatMoney(left)}</dd></div>` : ""}
    </dl>`;
}

function renderCard(request) {
  const phone = request.recipient_phone
    ? `<a href="tel:${escapeHtml(request.recipient_phone)}">${escapeHtml(request.recipient_phone)}</a>`
    : "";
  const issuedTotal = request.lines.reduce((sum, line) => sum + line.issued, 0);
  const agreedTotal = request.lines.reduce((sum, line) => sum + line.qty, 0);
  $("[data-card]").innerHTML = `
    <div class="ma-card-head">
      <p class="ma-eyebrow"><span>Заявка ${escapeHtml(request.id)}</span>${chip(request.status)}</p>
      <h1>${escapeHtml(request.project || "Без проекта")}</h1>
    </div>
    <dl class="ma-facts">
      ${fact("Даты", escapeHtml(formatPeriod(request)) + (request.days ? ` · ${request.days} сут` : ""))}
      ${fact("Получатель", escapeHtml(request.recipient))}
      ${fact("Телефон", phone)}
      ${fact("Оформил", escapeHtml(request.author))}
      ${fact("Расчёт", escapeHtml(request.settlement))}
      ${fact("Документы", escapeHtml(request.doc_status))}
    </dl>

    <section class="ma-block">
      <h2>Позиции <small>выдано ${issuedTotal} из ${agreedTotal}</small></h2>
      <div class="ma-lines">${request.lines.length ? request.lines.map(lineHtml).join("") : `<div class="ma-empty">В заявке пока нет позиций</div>`}</div>
    </section>

    <section class="ma-block">
      <h2>Деньги ${request.pay_status ? `<small>${escapeHtml(request.pay_status)}</small>` : ""}</h2>
      ${moneyHtml(request)}
    </section>

    ${request.comment ? `<section class="ma-block"><h2>Комментарий</h2><p>${escapeHtml(request.comment)}</p></section>` : ""}

    <div class="ma-note"><strong>Действия скоро появятся здесь</strong>Согласование, выдача, возврат и оплата пока проводятся в боте. Следующим шагом они переедут сюда с теми же проверками.</div>`;
}

// ---------------------------------------------------------------- навигация

function show(view) {
  document.querySelectorAll("[data-view]").forEach((section) => {
    section.hidden = section.dataset.view !== view;
  });
  const back = $("[data-back]");
  if (tg?.BackButton) {
    back.hidden = true;
    if (view === "card") tg.BackButton.show();
    else tg.BackButton.hide();
  }
  window.scrollTo(0, 0);
}

function showMessage(title, text) {
  $("[data-message]").innerHTML = `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>`;
  show("message");
}

async function route() {
  const match = /^#\/r\/(.+)$/.exec(location.hash);
  if (!match) {
    show("list");
    return;
  }
  const id = decodeURIComponent(match[1]);
  $("[data-card]").innerHTML = `<div class="ma-empty">Открываем заявку ${escapeHtml(id)}…</div>`;
  show("card");
  try {
    renderCard(await state.client.request(id));
  } catch (error) {
    $("[data-card]").innerHTML = `<div class="ma-empty"><strong>Заявку открыть не удалось</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function goList() {
  if (location.hash) history.pushState(null, "", location.pathname + location.search);
  route();
}

// ---------------------------------------------------------------- запуск

async function start() {
  if (tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.("#f7f7f5");
    tg.setBackgroundColor?.("#f7f7f5");
    tg.BackButton?.onClick(goList);
  }

  const apiRoot = readApiRoot();
  const initData = tg?.initData || "";
  if (apiRoot && initData) {
    state.client = createClient({ apiRoot, initData });
  } else {
    state.client = createDemoClient();
  }

  try {
    const me = await state.client.me();
    $("[data-user]").innerHTML = `<strong>${escapeHtml(me.name)}</strong><small>${escapeHtml(me.role_title)}</small>`;
    state.requests = await state.client.requests("all");
    if (state.client.mode === "live") setMode("live", "Данные со склада · только просмотр");
    else setMode("demo", apiRoot ? "Демо-данные · откройте экран из бота, чтобы войти" : "Демо-данные · склад ещё не подключён");
  } catch (error) {
    setMode("error", "Склад не ответил");
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      showMessage("Нет доступа", error.message);
    } else {
      showMessage("Склад недоступен", `${error.message}. Попробуйте открыть экран чуть позже.`);
    }
    return;
  }

  renderStats();
  renderList();
  route();
}

document.addEventListener("click", (event) => {
  const open = event.target.closest("[data-open]");
  if (open) {
    location.hash = `#/r/${encodeURIComponent(open.dataset.open)}`;
    tg?.HapticFeedback?.selectionChanged();
    return;
  }
  const scope = event.target.closest("[data-scope]");
  if (scope) {
    state.scope = scope.dataset.scope;
    document.querySelectorAll("[data-scope]").forEach((button) => button.classList.toggle("is-active", button === scope));
    renderList();
    return;
  }
  if (event.target.closest("[data-back]")) goList();
});

$("[data-search]").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderList();
});

window.addEventListener("hashchange", route);
start();
