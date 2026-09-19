import test from "node:test";
import assert from "node:assert/strict";
import { inventoryCategories, inventoryProducts, inventoryStats } from "../src/inventory.mjs";

test("рабочая опись содержит 89 позиций заказчика и режиссёрское кресло", () => {
  assert.equal(inventoryProducts.length, 90);
  assert.equal(inventoryStats.total, 90);
});

test("идентификаторы уникальны, а категории существуют", () => {
  const ids = inventoryProducts.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  const categoryIds = new Set(inventoryCategories.map((category) => category.id));
  inventoryProducts.forEach((item) => assert.ok(categoryIds.has(item.category), `${item.id}: неизвестная категория`));
});

test("каждая позиция имеет понятное название и статус публикации", () => {
  inventoryProducts.forEach((item) => {
    assert.ok(item.name.length >= 3);
    assert.equal(typeof item.published, "boolean");
  });
});
