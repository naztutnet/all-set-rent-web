import test from "node:test";
import assert from "node:assert/strict";
import {
  STATUS, canIssue, canReturn, issueDraft, newActionToken, nonZero, returnDraft, createClient, createDemoClient, debt, demoRequests, filterRequests, formatMoney, formatPeriod, summarize,
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

test("черновики форм: всё оставшееся по умолчанию", () => {
  const partial = demoRequests.find((r) => r.id === "З-0012");
  assert.ok(canIssue(partial) && canReturn(partial));
  assert.deepEqual(issueDraft(partial), { "ITM-0004": 1 });
  assert.deepEqual(returnDraft(partial)["ITM-0050"], { returned: 12, lost: 0 });
  assert.ok(!canIssue(demoRequests.find((r) => r.status === STATUS.draft)), "черновик не выдают");
  assert.deepEqual(nonZero({ a: 0, b: 2 }), { b: 2 });
  assert.match(newActionToken(), /^[0-9a-f]{16}$/);
});

test("демо: выдача, повтор формы и устаревший экран", async () => {
  const client = createDemoClient();
  const before = await client.request("З-0012");
  const token = newActionToken();
  const first = await client.issue("З-0012", { revision: before.revision, action_token: token, lines: { "ITM-0004": 1 } });
  assert.equal(first.repeat, false);
  assert.equal(first.request.status, STATUS.issued);
  const again = await client.issue("З-0012", { revision: before.revision, action_token: token, lines: { "ITM-0004": 1 } });
  assert.equal(again.repeat, true, "та же форма второй раз не проводится");
  assert.equal(again.request.lines[0].issued, 3);
  await assert.rejects(
    client.issue("З-0012", { revision: before.revision, action_token: newActionToken(), lines: {} }),
    (error) => error.status === 409,
  );
  const fresh = await client.request("З-0012");
  const back = await client.returnItems("З-0012", {
    revision: fresh.revision, action_token: newActionToken(), returned: { "ITM-0004": 3, "ITM-0050": 11 }, lost: { "ITM-0050": 1 },
  });
  assert.equal(back.request.on_hand, 0);
  assert.equal(back.request.lost_open, 1);
  assert.notEqual(back.request.status, STATUS.closed, "утрата без решения держит заявку открытой");
  assert.equal(demoRequests.find((r) => r.id === "З-0012").lines[0].issued, 2, "исходные демо-данные не меняются");
});
