import test from "node:test";
import assert from "node:assert/strict";
import { inventoryProducts } from "../src/inventory.mjs";
import { categoryFor, createStorefront, lineTotal, matchInventory, toProduct } from "../src/storefront-live.mjs";

test("фото подбираются по смыслу названия, размеры обязаны совпасть", () => {
  assert.equal(matchInventory("Мобильный шатер «3х6»", inventoryProducts)?.id, "tent-3x6");
  assert.equal(matchInventory("Мобильный шатер «3х3»", inventoryProducts)?.id, "tent-3x3");
  assert.equal(matchInventory("Тепловая электрическая пушка 3квт", inventoryProducts)?.name, "Тепловая электрическая пушка 3 кВт");
  assert.equal(matchInventory("Совсем другая вещь 999", inventoryProducts), null);
});

test("категории без совпадения раскладываются по смыслу", () => {
  assert.equal(categoryFor({ category: "Электрооборудование", name: "Капельная кофемашина" }, null), "catering");
  assert.equal(categoryFor({ category: "Расходники", name: "Скотч малярный 50 мм" }, null), "consumables");
  assert.equal(categoryFor({ category: "Прочее", name: "Каска строительная" }, null), "safety");
  assert.equal(categoryFor({ category: "Генераторы", name: "Генератор 4.5квт" }, null), "power");
});

test("сумма как в складе: сутки включительно, расходник разово", () => {
  const tent = toProduct({ id: "ITM-0027", category: "Шатры", name: "Мобильный шатер «3х6»", unit: "шт", consumable: false, price_per_day: "3500.00" }, inventoryProducts, 0);
  assert.equal(tent.price, 3500);
  assert.ok(tent.image, "у шатра есть фото с сайта");
  assert.equal(lineTotal(tent, 2, 3), 21000);
  assert.equal(lineTotal({ price: 80, consumable: true }, 10, 3), 800);
});

test("клиент витрины говорит со складом и понимает отказы", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body });
    if (url.endsWith("/orders")) return new Response(JSON.stringify({ detail: "На эти даты не хватает: Стул" }), { status: 409 });
    return new Response(JSON.stringify({ free: { "ITM-0001": 3 } }), { status: 200 });
  };
  const store = createStorefront("https://sklad.example", fetchImpl);
  assert.deepEqual(await store.availability("2026-10-20", "2026-10-22"), { "ITM-0001": 3 });
  assert.equal(calls[0].url, "https://sklad.example/api/v1/public/availability?date_out=2026-10-20&date_back=2026-10-22");
  await assert.rejects(store.order({ lines: [] }), (error) => error.status === 409 && /не хватает/.test(error.message));
  assert.equal(calls[1].method, "POST");
});

test("комплект: цена суммой, сколько собрать решает самая редкая позиция", async () => {
  const { kitView, liveKits } = await import("../src/storefront-live.mjs");
  const radio = liveKits.find((kit) => kit.id === "kit-radio");
  const products = new Map([
    ["ITM-0077", { id: "ITM-0077", name: "Рация Kenwood", price: 200 }],
    ["ITM-0056", { id: "ITM-0056", name: "USB зарядная станция 10 портов", price: 300 }],
    ["ITM-0063", { id: "ITM-0063", name: "Громкоговоритель", price: 400 }],
  ]);
  const view = kitView(radio, products, { "ITM-0077": 16, "ITM-0056": 4, "ITM-0063": 1 });
  assert.equal(view.price, 2300);
  assert.equal(view.available, 1, "громкоговоритель один: собрать можно один комплект");
  assert.equal(kitView(radio, new Map(), {}), null, "без позиций склада комплект не показывается");
  for (const kit of liveKits) assert.ok(kit.items.every(([id, qty]) => /^ITM-\d{4}$/.test(id) && qty > 0), kit.id);
});

test("помощник: включён ли и разбор текста", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body });
    if (options.method === "GET") return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    return new Response(JSON.stringify({ understood: true, people: 70 }), { status: 200 });
  };
  const store = createStorefront("https://sklad.example", fetchImpl);
  assert.equal(await store.assistEnabled(), true);
  assert.equal(calls[0].url, "https://sklad.example/api/v1/public/assist");
  assert.equal((await store.assist("70 человек в лесу")).people, 70);
  assert.deepEqual(JSON.parse(calls[1].body), { text: "70 человек в лесу" });

  const offline = createStorefront("https://sklad.example", async () => { throw new Error("нет сети"); });
  assert.equal(await offline.assistEnabled(), false, "склад не ответил: помощника не показываем");
});
