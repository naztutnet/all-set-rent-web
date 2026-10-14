import test from "node:test";
import assert from "node:assert/strict";
import {
  STATUS, createClient, createDemoClient, debt, demoRequests, filterRequests, formatMoney, formatPeriod, summarize,
} from "../src/warehouse-api.mjs";

test("деньги строкой форматируются без потери копеек", () => {
  assert.equal(formatMoney("1043.48").replace(/\s/g, " "), "1 043,48 ₽");
  assert.equal(formatMoney("abc"), "—");
});

test("период заявки читается по-человечески", () => {
  assert.match(formatPeriod({ date_out: "2026-10-15", date_back: "2026-10-17" }), /15 окт.* → 17 окт/);
  assert.equal(formatPeriod({ date_out: "" }), "даты не заданы");
});

test("сводка считает только открытые и не считает долгом черновик", () => {
  const stats = summarize(demoRequests);
  assert.equal(stats.open, demoRequests.filter((r) => ![STATUS.closed, STATUS.cancelled].includes(r.status)).length);
  const draft = demoRequests.find((r) => r.status === STATUS.draft);
  assert.ok(debt(draft) > 0, "у черновика есть сумма");
  assert.equal(stats.unpaid, 2, "долг у согласованной и частично выданной");
});

test("фильтр: открытые по умолчанию, поиск по номеру и проекту", () => {
  assert.ok(filterRequests(demoRequests).every((r) => r.status !== STATUS.closed));
  assert.equal(filterRequests(demoRequests, { scope: "all" }).length, demoRequests.length);
  assert.deepEqual(filterRequests(demoRequests, { scope: "all", query: "з-0013" }).map((r) => r.id), ["З-0013"]);
  assert.equal(filterRequests(demoRequests, { scope: "all", query: "вегетация" }).length, 2);
});

test("демо-клиент отдаёт тот же формат, что API", async () => {
  const client = createDemoClient();
  const list = await client.requests();
  assert.ok(list.every((r) => !("lines" in r)), "в списке нет строк, как в API");
  const card = await client.request("З-0012");
  assert.equal(card.lines.length, 2);
  await assert.rejects(client.request("З-9999"), /не найдена/);
});

test("живой клиент шлёт подпись Telegram и понимает отказ", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization });
    if (url.endsWith("/me")) return new Response(JSON.stringify({ detail: "Доступа к складу нет." }), { status: 403 });
    return new Response(JSON.stringify({ requests: [{ id: "З-0001" }] }), { status: 200 });
  };
  const client = createClient({ apiRoot: "https://api.example/", initData: "user=1&hash=x", fetchImpl });
  assert.deepEqual(await client.requests("open"), [{ id: "З-0001" }]);
  assert.equal(calls[0].url, "https://api.example/api/v1/requests?scope=open");
  assert.equal(calls[0].auth, "tma user=1&hash=x");
  await assert.rejects(client.me(), (error) => error.status === 403 && /Доступа/.test(error.message));
});
