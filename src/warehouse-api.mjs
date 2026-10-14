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

  async function get(path) {
    const response = await fetchImpl(`${root}/api/v1${path}`, {
      headers: { Accept: "application/json", Authorization: `tma ${initData}` },
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      throw new ApiError(body?.detail || `Склад ответил ${response.status}`, response.status);
    }
    return body;
  }

  return {
    mode: "live",
    me: () => get("/me"),
    requests: (scope = "all") => get(`/requests?scope=${encodeURIComponent(scope)}`).then((body) => body.requests),
    request: (id) => get(`/requests/${encodeURIComponent(id)}`),
  };
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

export function createDemoClient() {
  const byId = new Map(demoRequests.map((request) => [request.id, request]));
  return {
    mode: "demo",
    me: async () => demoUser,
    requests: async () => demoRequests.map(({ lines, money, ...summary }) => summary),
    request: async (id) => {
      const found = byId.get(id);
      if (!found) throw new ApiError("Заявка не найдена.", 404);
      return found;
    },
  };
}
