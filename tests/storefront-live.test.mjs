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
