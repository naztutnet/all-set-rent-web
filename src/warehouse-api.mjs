// Связь админки (Telegram Mini App и сайт) с API Бот-Склада.
// Формат данных повторяет ответы API один в один (allset-warehouse-bot, docs/API.md),
// поэтому демо-режим и живой режим рисуются одним и тем же кодом.

export const STATUS = {
  draft: "черновик",
  approved: "согласована",
  partial: "частично выдана",
  issued: "выдана",
  closed: "закрыта",
  cancelled: "отменена",
};

const STATUS_TONE = {
  [STATUS.draft]: "muted",
  [STATUS.approved]: "accent",
  [STATUS.partial]: "amber",
  [STATUS.issued]: "green",
  [STATUS.closed]: "done",
  [STATUS.cancelled]: "done",
};

export function statusTone(status) {
  return STATUS_TONE[status] || "muted";
}

const rub = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

// Деньги приходят строкой "250.00": так копейки не теряются по дороге.
export function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${rub.format(number)} ₽`;
}

const shortDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

export function formatDate(value) {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return shortDate.format(date).replace(".", "");
}

export function formatPeriod(request) {
  if (!request.date_out) return "даты не заданы";
  const out = formatDate(request.date_out);
  const back = formatDate(request.date_back);
  return back ? `${out} → ${back}` : out;
}

export function isOpen(request) {
  return request.status !== STATUS.closed && request.status !== STATUS.cancelled;
}

export function debt(request) {
  return Math.max(Number(request.payable) - Number(request.paid), 0);
}

// Что требует внимания склада: цифры для плиток над списком.
export function summarize(requests) {
  const open = requests.filter(isOpen);
  return {
    open: open.length,
    toIssue: open.reduce((sum, request) => sum + (request.to_issue || 0), 0),
    onHand: open.reduce((sum, request) => sum + (request.on_hand || 0), 0),
    unpaid: open.filter((request) => request.status !== STATUS.draft && debt(request) > 0).length,
  };
}

export function filterRequests(requests, { scope = "open", query = "" } = {}) {
  const needle = query.trim().toLowerCase();
  return requests.filter((request) => {
    if (scope === "open" && !isOpen(request)) return false;
    if (!needle) return true;
    return [request.id, request.project, request.recipient, request.author]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(needle));
  });
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Живой клиент. Вход только через подпись Telegram: initData из Mini App.
export function createClient({ apiRoot, initData, fetchImpl = globalThis.fetch }) {
  const root = (apiRoot || "").replace(/\/$/, "");

  async function call(path, body) {
    const headers = { Accept: "application/json", Authorization: `tma ${initData}` };
    if (body) headers["Content-Type"] = "application/json";
    const response = await fetchImpl(`${root}/api/v1${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let answer = null;
    try {
      answer = await response.json();
    } catch {
      answer = null;
    }
    if (!response.ok) {
      const detail = typeof answer?.detail === "string" ? answer.detail : "";
      throw new ApiError(detail || `Склад ответил ${response.status}`, response.status);
    }
    return answer;
  }
  const get = (path) => call(path);

  return {
    mode: "live",
    me: () => get("/me"),
    requests: (scope = "all") => get(`/requests?scope=${encodeURIComponent(scope)}`).then((body) => body.requests),
    request: (id) => get(`/requests/${encodeURIComponent(id)}`),
    issue: (id, body) => call(`/requests/${encodeURIComponent(id)}/issue`, body),
    returnItems: (id, body) => call(`/requests/${encodeURIComponent(id)}/return`, body),
    approve: (id, body) => call(`/requests/${encodeURIComponent(id)}/approve`, body),
    cancel: (id, body) => call(`/requests/${encodeURIComponent(id)}/cancel`, body),
    cancelRemainder: (id, body) => call(`/requests/${encodeURIComponent(id)}/cancel-remainder`, body),
    resolveLoss: (id, body) => call(`/requests/${encodeURIComponent(id)}/resolve-loss`, body),
    payments: (id) => get(`/requests/${encodeURIComponent(id)}/payments`).then((answer) => answer.payments),
    addPayment: (id, body) => call(`/requests/${encodeURIComponent(id)}/payments`, body),
    reversePayment: (id, paymentId, body) =>
      call(`/requests/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}/reverse`, body),
  };
}

// Какие решения доступны по заявке. Кнопки рисуются по ним, решает всегда склад.
export function decisionsFor(request, rights = {}) {
  const issued = request.lines.some((line) => line.issued > 0);
  return {
    approve: Boolean(rights.approve) && request.status === STATUS.draft && request.lines.length > 0,
    cancel: (request.status === STATUS.draft && Boolean(rights.draft))
      || (request.status === STATUS.approved && !issued && Boolean(rights.approve)),
    remainder: Boolean(rights.approve) && request.status === STATUS.partial && request.to_issue > 0,
    loss: Boolean(rights.losses) && request.lost_open > 0,
    pay: Boolean(rights.money) && ![STATUS.draft, STATUS.cancelled].includes(request.status),
  };
}

// ---------------------------------------------------------------- действия

// Одноразовый токен формы: повторная отправка той же формы не проведётся дважды.
export function newActionToken() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canIssue(request) {
  return [STATUS.approved, STATUS.partial].includes(request.status)
    && request.lines.some((line) => line.to_issue > 0);
}

export function canReturn(request) {
  return request.lines.some((line) => line.kind !== "расходник" && line.on_hand > 0);
}

// Черновик формы: по умолчанию «всё, что осталось», правится плюсом и минусом.
export function issueDraft(request) {
  return Object.fromEntries(request.lines.filter((line) => line.to_issue > 0).map((line) => [line.item_id, line.to_issue]));
}

export function returnDraft(request) {
  return Object.fromEntries(
    request.lines.filter((line) => line.kind !== "расходник" && line.on_hand > 0).map((line) => [line.item_id, { returned: line.on_hand, lost: 0 }]),
  );
}

export function nonZero(numbers) {
  return Object.fromEntries(Object.entries(numbers).filter(([, qty]) => qty > 0));
}

// ---------------------------------------------------------------- демо-данные
// Позиции и цены взяты из каталога сайта; заявки выдуманы для показа экрана.

function line(item_id, name, price, qty, { issued = 0, returned = 0, lost = 0, days = 3, unit = "шт" } = {}) {
  const amount = (price * qty * days).toFixed(2);
  const onHand = issued - returned - lost;
  return {
    item_id, name, unit, kind: "возвратная", mode: "аренда",
    qty, issued, returned, lost, written_off: 0, cancelled: 0,
    on_hand: onHand, to_issue: qty - issued, lost_open: lost, days,
    price_per_day: price.toFixed(2), amount, settled: onHand <= 0 && qty - issued <= 0 && lost <= 0,
  };
}

function demoRequest(base, lines, money) {
  const payable = money.payable ?? lines.reduce((sum, row) => sum + Number(row.amount), 0);
  return {
    ...base,
    positions: lines.length,
    on_hand: lines.reduce((sum, row) => sum + row.on_hand, 0),
    to_issue: lines.reduce((sum, row) => sum + Math.max(row.to_issue, 0), 0),
    lost_open: lines.reduce((sum, row) => sum + row.lost_open, 0),
    payable: payable.toFixed(2),
    paid: (money.paid ?? 0).toFixed(2),
    pay_status: money.pay_status || "",
    doc_status: money.doc_status || "",
    comment: base.comment || "",
    recipient_phone: base.recipient_phone || "",
    settlement: money.settlement || "безнал",
    priced: base.status !== STATUS.draft,
    money: {
      price_total: payable.toFixed(2), price_mode: base.status === STATUS.draft ? "" : "прайс",
      discount: "0.00", fixed: "0.00", rent: payable.toFixed(2), tax_rate: "0.00",
      payable: payable.toFixed(2), paid: (money.paid ?? 0).toFixed(2), pay_due: money.pay_due || "", paid_at: "",
    },
    estimate_version: base.status === STATUS.draft ? 0 : 1,
    closed_at: "",
    closable: lines.every((row) => row.settled),
    revision: 3,
    lines,
  };
}

export const demoUser = {
  id: 0, name: "Демо-режим", role: "supervisor", role_title: "супервайзер",
  rights: { view: true, draft: true, issue: true, stock: true, approve: true, price: true, money: true, papers: true, losses: true, admin: true },
};

export const demoRequests = [
  demoRequest(
    { id: "З-0014", created: "2026-10-12 18:40", project: "Вегетация", recipient: "Пётр, площадка", author: "Саша",
      status: STATUS.draft, date_out: "2026-10-20", date_back: "2026-10-23", days: 4, recipient_phone: "" },
    [line("ITM-0004", "Шатёр 3×6 чёрный со стенками", 3500, 2, { days: 4 }), line("ITM-0021", "Стул складной", 250, 20, { days: 4 })],
    {},
  ),
  demoRequest(
    { id: "З-0013", created: "2026-10-10 11:05", project: "Ночная смена", recipient: "Ирина, АХЧ", author: "Саша",
      status: STATUS.approved, date_out: "2026-10-15", date_back: "2026-10-17", days: 3 },
    [line("ITM-0031", "Тепловая пушка 3 кВт", 1200, 4), line("ITM-0040", "Удлинитель 20 м", 100, 10), line("ITM-0022", "Стол раскладной", 400, 6)],
    { pay_status: "ждёт оплаты", pay_due: "2026-10-15" },
  ),
  demoRequest(
    { id: "З-0012", created: "2026-10-08 09:30", project: "Сериал «Берег»", recipient: "Дима, площадка", author: "Лена",
      status: STATUS.partial, date_out: "2026-10-11", date_back: "2026-10-18", days: 8 },
    [line("ITM-0004", "Шатёр 3×6 чёрный со стенками", 3500, 3, { issued: 2, days: 8 }), line("ITM-0050", "Рация", 300, 12, { issued: 12, days: 8 })],
    { paid: 30000, pay_status: "частично оплачена" },
  ),
  demoRequest(
    { id: "З-0011", created: "2026-10-03 15:12", project: "Реклама «Север»", recipient: "Олег", author: "Саша",
      status: STATUS.issued, date_out: "2026-10-04", date_back: "2026-10-14", days: 11 },
    [line("ITM-0060", "Зеркало гримёрное с подсветкой", 900, 2, { issued: 2, days: 11 }), line("ITM-0021", "Стул складной", 250, 12, { issued: 12, returned: 4, days: 11 })],
    { paid: 52800, pay_status: "оплачена", doc_status: "акт подписан" },
  ),
  demoRequest(
    { id: "З-0010", created: "2026-09-25 10:00", project: "Вегетация", recipient: "Пётр, площадка", author: "Саша",
      status: STATUS.closed, date_out: "2026-09-26", date_back: "2026-09-28", days: 3 },
    [line("ITM-0040", "Удлинитель 20 м", 100, 8, { issued: 8, returned: 8 })],
    { paid: 2400, pay_status: "оплачена", doc_status: "акт подписан" },
  ),
];

function recount(request) {
  for (const line of request.lines) {
    line.on_hand = line.issued - line.returned - line.lost;
    line.to_issue = line.qty - line.issued - line.cancelled;
    line.lost_open = line.lost - line.written_off;
    line.settled = line.on_hand <= 0 && line.to_issue <= 0 && line.lost_open <= 0;
  }
  const sum = (key) => request.lines.reduce((total, line) => total + Math.max(line[key], 0), 0);
  request.on_hand = sum("on_hand");
  request.to_issue = sum("to_issue");
  request.lost_open = sum("lost_open");
  request.closable = request.lines.every((line) => line.settled);
  if (request.closable) request.status = STATUS.closed;
  else if (request.to_issue > 0 && request.lines.some((line) => line.issued > 0)) request.status = STATUS.partial;
  else if (request.to_issue === 0) request.status = STATUS.issued;
  request.revision += 1;
}

export function createDemoClient() {
  const byId = new Map(demoRequests.map((request) => [request.id, structuredClone(request)]));
  const done = new Set();
  const paymentsById = new Map([["З-0012", [{ id: "PAY-1", amount: "30000.00", date: "2026-10-11", author: "Саша", comment: "безнал", reverses: "", reversed: false }]]]);

  function act(id, body, apply) {
    const request = byId.get(id);
    if (!request) throw new ApiError("Заявка не найдена.", 404);
    if (done.has(body.action_token)) return { repeat: true, request: structuredClone(request) };
    if (body.revision !== request.revision) throw new ApiError("Заявку успели изменить, пока экран был открыт.", 409);
    apply(request);
    done.add(body.action_token);
    recount(request);
    return { repeat: false, request: structuredClone(request) };
  }

  return {
    mode: "demo",
    me: async () => demoUser,
    requests: async () => [...byId.values()].map(({ lines, money, ...summary }) => structuredClone(summary)),
    request: async (id) => {
      const found = byId.get(id);
      if (!found) throw new ApiError("Заявка не найдена.", 404);
      return structuredClone(found);
    },
    issue: async (id, body) => act(id, body, (request) => {
      for (const [itemId, qty] of Object.entries(body.lines)) {
        const line = request.lines.find((row) => row.item_id === itemId);
        if (!line || qty > line.to_issue) throw new ApiError(`«${line?.name || itemId}»: осталось выдать ${line?.to_issue ?? 0}, а не ${qty}.`, 400);
        line.issued += qty;
      }
    }),
    approve: async (id, body) => act(id, { ...body, action_token: `approve-${id}-${body.revision}` }, (request) => {
      if (request.status !== STATUS.draft) throw new ApiError("Согласовать можно только черновик.", 400);
      request.status = STATUS.approved;
      request.priced = true;
    }),
    cancel: async (id, body) => act(id, { ...body, action_token: `cancel-${id}-${body.revision}` }, (request) => {
      request.status = STATUS.cancelled;
    }),
    cancelRemainder: async (id, body) => act(id, { ...body, action_token: `rest-${id}-${body.revision}` }, (request) => {
      for (const line of request.lines) line.cancelled += Math.max(line.to_issue, 0);
    }),
    resolveLoss: async (id, body) => act(id, body, (request) => {
      const line = request.lines.find((row) => row.item_id === body.item_id);
      if (!line || body.qty > line.lost_open) throw new ApiError("Столько утраты по позиции нет.", 400);
      line.written_off += body.qty;
    }),
    payments: async (id) => structuredClone(paymentsById.get(id) || []),
    addPayment: async (id, body) => {
      const request = byId.get(id);
      if (done.has(body.action_token)) return { repeat: true, request: structuredClone(request) };
      done.add(body.action_token);
      const list = paymentsById.get(id) || [];
      list.push({ id: `PAY-${list.length + 1}`, amount: Number(body.amount).toFixed(2), date: "сегодня", author: "Демо", comment: [body.method, body.comment].filter(Boolean).join(" · "), reverses: "", reversed: false });
      paymentsById.set(id, list);
      request.paid = (Number(request.paid) + Number(body.amount)).toFixed(2);
      request.money.paid = request.paid;
      return { repeat: false, request: structuredClone(request) };
    },
    reversePayment: async (id, paymentId) => {
      const request = byId.get(id);
      const list = paymentsById.get(id) || [];
      const original = list.find((payment) => payment.id === paymentId);
      if (!original || original.reversed) throw new ApiError("Этот платёж уже исправлен.", 400);
      original.reversed = true;
      list.push({ id: `PAY-${list.length + 1}`, amount: (-Number(original.amount)).toFixed(2), date: "сегодня", author: "Демо", comment: "сторно", reverses: paymentId, reversed: false });
      request.paid = (Number(request.paid) - Number(original.amount)).toFixed(2);
      request.money.paid = request.paid;
      return { repeat: false, request: structuredClone(request) };
    },
    returnItems: async (id, body) => act(id, body, (request) => {
      const ids = new Set([...Object.keys(body.returned || {}), ...Object.keys(body.lost || {})]);
      for (const itemId of ids) {
        const line = request.lines.find((row) => row.item_id === itemId);
        const taken = (body.returned?.[itemId] || 0) + (body.lost?.[itemId] || 0);
        if (!line || taken > line.on_hand) throw new ApiError(`«${line?.name || itemId}»: на руках ${line?.on_hand ?? 0}, а не ${taken}.`, 400);
        line.returned += body.returned?.[itemId] || 0;
        line.lost += body.lost?.[itemId] || 0;
      }
    }),
  };
}
