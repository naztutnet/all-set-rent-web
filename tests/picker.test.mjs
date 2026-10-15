import test from "node:test";
import assert from "node:assert/strict";
import { buildVariants, contextFor, seasonOf } from "../src/picker.mjs";

const products = new Map([
  ["ITM-0020", { id: "ITM-0020", name: "Стул", price: 100, consumable: false }],
  ["ITM-0027", { id: "ITM-0027", name: "Шатёр 3×6", price: 3500, consumable: false }],
  ["ITM-0055", { id: "ITM-0055", name: "Пушка 9 кВт", price: 1500, consumable: false }],
  ["ITM-0047", { id: "ITM-0047", name: "Вентилятор", price: 500, consumable: false }],
  ["ITM-0124", { id: "ITM-0124", name: "Мешки 120 л", price: 15, consumable: true }],
]);

test("сезон по дате начала", () => {
  assert.equal(seasonOf("2026-01-10"), "winter");
  assert.equal(seasonOf("2026-07-01"), "summer");
  assert.equal(seasonOf("2026-10-01"), "offseason");
});

test("зимой на натуре есть пушки, летом вентиляторы, в павильоне нет шатров", () => {
  const ids = (input) => buildVariants(input, products)[1].rows.map((row) => row.product.id);
  const winter = ids({ people: 50, location: "nature", dateOut: "2026-12-01", dateBack: "2026-12-05" });
  assert.ok(winter.includes("ITM-0055") && !winter.includes("ITM-0047"));
  const summer = ids({ people: 50, location: "nature", dateOut: "2026-07-01", dateBack: "2026-07-02" });
  assert.ok(summer.includes("ITM-0047") && !summer.includes("ITM-0055"));
  const studio = ids({ people: 50, location: "studio", dateOut: "2026-12-01", dateBack: "2026-12-05" });
  assert.ok(!studio.includes("ITM-0027"), "в павильоне шатёр не нужен");
});

test("три варианта растут по количеству, сумма за весь срок, расходник на смену", () => {
  const variants = buildVariants({ people: 60, location: "nature", dateOut: "2026-12-01", dateBack: "2026-12-05" }, products, { "ITM-0027": 1 });
  const chairs = variants.map((variant) => variant.rows.find((row) => row.product.id === "ITM-0020").qty);
  assert.ok(chairs[0] < chairs[1] && chairs[1] < chairs[2], `стулья растут: ${chairs}`);
  const opt = variants[1];
  assert.equal(opt.context.shifts, 5);
  assert.equal(opt.rows.find((row) => row.product.id === "ITM-0124").qty, 6 * 5, "мешки: 6 в смену × 5 смен");
  assert.ok(opt.short.some((row) => row.product.id === "ITM-0027"), "нехватка шатров видна");
});

test("число людей держится в разумных границах", () => {
  assert.equal(contextFor({ people: 2, dateOut: "2026-12-01", dateBack: "2026-12-01" }).people, 5);
  assert.equal(contextFor({ people: 99999, dateOut: "2026-12-01", dateBack: "2026-12-01" }).people, 400);
});

test("просьбы клиента добавляются к правилам, не уменьшая их", () => {
  const input = {
    people: 50, location: "nature", dateOut: "2026-12-01", dateBack: "2026-12-02",
    extras: [
      { item_id: "ITM-0047", qty: 2, why: "просили вентиляторы для грима" },
      { item_id: "ITM-0020", qty: 1, why: "стул режиссёру" },
      { item_id: "ITM-9999", qty: 3, why: "нет на складе" },
    ],
  };
  const [min, opt] = buildVariants(input, products);
  const fan = opt.rows.find((row) => row.product.id === "ITM-0047");
  assert.equal(fan.qty, 2, "зимой вентиляторов по правилам нет, но клиент попросил");
  assert.ok(fan.why.includes("просили вентиляторы для грима"));
  assert.equal(min.rows.find((row) => row.product.id === "ITM-0047").qty, 2, "просьба без множителя варианта");
  const chairs = opt.rows.find((row) => row.product.id === "ITM-0020");
  assert.ok(chairs.qty > 1, "просьба не уменьшает посчитанное правилами");
  assert.ok(!opt.rows.some((row) => row.product.id === "ITM-9999"), "чего нет в каталоге, того нет в наборе");
});
