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

test("у каждой позиции задан временный положительный остаток", () => {
  inventoryProducts.forEach((item) => {
    assert.ok(Number.isInteger(item.stock) && item.stock > 0, `${item.id}: нет временного остатка`);
    assert.equal(item.stockEstimated, true);
  });
});

test("на первом экране каталога у всех 12 позиций есть фотография", () => {
  inventoryProducts.slice(0, 12).forEach((item) => {
    assert.match(item.image || "", /^assets\/catalog\/.+\.webp$/, `${item.id}: нет фотографии`);
  });
});

test("шатры используют чёрные версии фотографий со стенками", () => {
  ["tent-2x2", "tent-3x3", "tent-3x6"].forEach((id) => {
    const tent = inventoryProducts.find((item) => item.id === id);
    assert.match(tent?.image || "", /-black\.webp$/, `${id}: подключена старая фотография`);
  });
});
