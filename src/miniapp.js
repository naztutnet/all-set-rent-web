import {
  ApiError, canIssue, canReturn, createClient, createDemoClient, debt, filterRequests, formatDate,
  formatMoney, formatPeriod, issueDraft, newActionToken, nonZero, returnDraft, statusTone, summarize,
} from "./warehouse-api.mjs?v=2";

const tg = window.Telegram?.WebApp;
const $ = (selector) => document.querySelector(selector);

const state = { client: null, me: null, requests: [], scope: "open", query: "", card: null, form: null };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

// Где искать склад: адрес из <meta>, сохранённый адрес или тот же сервер, с
// которого открыт экран. На сервере склада страница и API живут рядом, и
// настраивать ничего не нужно; на GitHub Pages проверка ответит отказом, и
// экран честно уйдёт в демо.
async function resolveApiRoot() {
  const configured = document.querySelector('meta[name="allset-api"]')?.content?.trim();
  if (configured) return configured;
  try {
    const stored = localStorage.getItem("allset-api-root")?.trim();
    if (stored) return stored;
  } catch {
    // хранилище недоступно: просто идём дальше
  }
  try {
    const response = await fetch("api/v1/health", { signal: AbortSignal.timeout(3000) });
    if (response.ok && (await response.json())?.ok === true) return location.origin;
  } catch {
    // склада рядом нет
  }
  return "";
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

function actionsHtml(request) {
  if (!state.me?.rights?.issue) return "";
  const buttons = [];
  if (canIssue(request)) buttons.push(`<button type="button" class="ma-action" data-act="issue">Выдать<small>осталось ${request.to_issue} ед.</small></button>`);
  if (canReturn(request)) buttons.push(`<button type="button" class="ma-action ma-action--light" data-act="return">Принять возврат<small>на руках ${request.on_hand} ед.</small></button>`);
  return buttons.length ? `<section class="ma-actions">${buttons.join("")}</section>` : "";
}

function renderCard(request) {
  state.card = request;
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

    ${actionsHtml(request)}
    <div class="ma-note"><strong>Остальное пока в боте</strong>Согласование, снятие остатка, решение по утрате и оплата пока проводятся кнопками бота. Они переедут сюда следующими шагами.</div>`;
}

// ---------------------------------------------------------------- выдача и возврат

function stepper(key, field, value, max, label) {
  return `
    <div class="ma-step">
      <span>${label}</span>
      <div>
        <button type="button" data-step="-1" data-key="${escapeHtml(key)}" data-field="${field}" ${value <= 0 ? "disabled" : ""} aria-label="Меньше">−</button>
        <b>${value}</b>
        <button type="button" data-step="1" data-key="${escapeHtml(key)}" data-field="${field}" ${value >= max ? "disabled" : ""} aria-label="Больше">+</button>
      </div>
    </div>`;
}

function formTotals() {
  const { kind, values } = state.form;
  if (kind === "issue") return { main: Object.values(values).reduce((sum, qty) => sum + qty, 0), lost: 0 };
  const rows = Object.values(values);
  return { main: rows.reduce((sum, row) => sum + row.returned, 0), lost: rows.reduce((sum, row) => sum + row.lost, 0) };
}

function renderSheet() {
  const sheet = $("[data-sheet]");
  if (!state.form) {
    sheet.hidden = true;
    document.body.classList.remove("is-locked");
    return;
  }
  const { kind, values, busy, error } = state.form;
  const request = state.card;
  const rows = request.lines
    .filter((line) => line.item_id in values)
    .map((line) => {
      if (kind === "issue") {
        return `<div class="ma-sheet-line"><strong>${escapeHtml(line.name)}</strong><small>осталось выдать ${line.to_issue} ${escapeHtml(line.unit)}</small>
          ${stepper(line.item_id, "qty", values[line.item_id], line.to_issue, "Выдаём")}</div>`;
      }
      const row = values[line.item_id];
      return `<div class="ma-sheet-line"><strong>${escapeHtml(line.name)}</strong><small>на руках ${line.on_hand} ${escapeHtml(line.unit)}</small>
        ${stepper(line.item_id, "returned", row.returned, line.on_hand - row.lost, "Вернули")}
        ${stepper(line.item_id, "lost", row.lost, line.on_hand - row.returned, "Утрата")}</div>`;
    })
    .join("");
  const totals = formTotals();
  const nothing = totals.main + totals.lost === 0;
  const label = kind === "issue"
    ? `Выдать ${totals.main} ед.`
    : `Принять ${totals.main} ед.${totals.lost ? ` · утрата ${totals.lost}` : ""}`;
  const comment = kind === "return"
    ? `<label class="ma-comment"><span>Комментарий${totals.lost ? " (что случилось)" : ""}</span><textarea rows="2" maxlength="500" data-comment>${escapeHtml(state.form.comment || "")}</textarea></label>`
    : "";
  sheet.innerHTML = `
    <div class="ma-sheet-backdrop" data-close></div>
    <div class="ma-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="ma-sheet-head">
        <div><p class="ma-eyebrow">Заявка ${escapeHtml(request.id)}</p><h2 id="sheet-title">${kind === "issue" ? "Выдача" : "Возврат"}</h2></div>
        <button type="button" class="ma-close" data-close aria-label="Закрыть">×</button>
      </div>
      <div class="ma-sheet-body">${rows}${comment}</div>
      ${totals.lost ? `<p class="ma-warn">Утраченное не вернётся на полку и будет ждать решения супервайзера.</p>` : ""}
      ${error ? `<p class="ma-error" role="alert">${escapeHtml(error)}</p>` : ""}
      <button type="button" class="ma-submit" data-submit ${busy || nothing ? "disabled" : ""}>${busy ? "Провожу…" : label}</button>
    </div>`;
  sheet.hidden = false;
  document.body.classList.add("is-locked");
}

function openForm(kind) {
  $("[data-toast]").classList.remove("is-visible");
  const request = state.card;
  state.form = {
    kind,
    token: newActionToken(),
    revision: request.revision,
    values: kind === "issue" ? issueDraft(request) : returnDraft(request),
    comment: "",
    busy: false,
    error: "",
  };
  renderSheet();
}

function closeForm() {
  state.form = null;
  renderSheet();
}

function changeStep(key, field, delta) {
  const { kind, values } = state.form;
  const line = state.card.lines.find((row) => row.item_id === key);
  if (kind === "issue") {
    values[key] = Math.min(Math.max(values[key] + delta, 0), line.to_issue);
  } else {
    const row = values[key];
    const other = field === "returned" ? row.lost : row.returned;
    row[field] = Math.min(Math.max(row[field] + delta, 0), line.on_hand - other);
  }
  state.form.error = "";
  tg?.HapticFeedback?.selectionChanged();
  renderSheet();
}

function toast(text) {
  const box = $("[data-toast]");
  box.textContent = text;
  box.classList.add("is-visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove("is-visible"), 2600);
}

async function refreshList() {
  try {
    state.requests = await state.client.requests("all");
    renderStats();
    renderList();
  } catch {
    // список обновится при следующем открытии
  }
}

async function submitForm() {
  const form = state.form;
  if (!form || form.busy) return;
  const request = state.card;
  let body;
  if (form.kind === "issue") {
    body = { revision: form.revision, action_token: form.token, lines: nonZero(form.values) };
  } else {
    const returned = nonZero(Object.fromEntries(Object.entries(form.values).map(([id, row]) => [id, row.returned])));
    const lost = nonZero(Object.fromEntries(Object.entries(form.values).map(([id, row]) => [id, row.lost])));
    body = { revision: form.revision, action_token: form.token, returned, lost, comment: form.comment.trim() };
  }
  form.busy = true;
  form.error = "";
  renderSheet();
  try {
    const result = form.kind === "issue"
      ? await state.client.issue(request.id, body)
      : await state.client.returnItems(request.id, body);
    closeForm();
    renderCard(result.request);
    tg?.HapticFeedback?.notificationOccurred("success");
    toast(result.repeat ? "Это уже было проведено" : form.kind === "issue" ? "Выдано" : "Возврат принят");
    refreshList();
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      closeForm();
      renderCard(await state.client.request(request.id));
      toast("Заявку изменили, пока экран был открыт. Данные обновлены");
      return;
    }
    // Токен формы сохраняется: повтор после обрыва связи не проведёт действие дважды.
    form.busy = false;
    form.error = error.message || "Не получилось. Попробуйте ещё раз.";
    tg?.HapticFeedback?.notificationOccurred("error");
    renderSheet();
  }
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
  if (state.form) {
    if (!state.form.busy) closeForm();
    return;
  }
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

  const apiRoot = await resolveApiRoot();
  const initData = tg?.initData || "";
  if (apiRoot && initData) {
    state.client = createClient({ apiRoot, initData });
  } else {
    state.client = createDemoClient();
  }

  try {
    const me = await state.client.me();
    state.me = me;
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
  const act = event.target.closest("[data-act]");
  if (act) {
    openForm(act.dataset.act);
    return;
  }
  const step = event.target.closest("[data-step]");
  if (step) {
    changeStep(step.dataset.key, step.dataset.field, Number(step.dataset.step));
    return;
  }
  if (event.target.closest("[data-submit]")) {
    submitForm();
    return;
  }
  if (event.target.closest("[data-close]")) {
    if (!state.form?.busy) closeForm();
    return;
  }
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

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-comment]") && state.form) state.form.comment = event.target.value;
});

$("[data-search]").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderList();
});

window.addEventListener("hashchange", route);
start();
