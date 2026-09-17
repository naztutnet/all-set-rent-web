import test from "node:test";
import assert from "node:assert/strict";
import {
  discountForDays,
  estimate,
  itemTotal,
  rentalDays,
} from "../src/catalog.mjs";

test("rentalDays counts both issue and return dates", () => {
  assert.equal(rentalDays("2026-09-18", "2026-09-20"), 3);
});

test("rentalDays never returns less than one", () => {
  assert.equal(rentalDays("2026-09-20", "2026-09-18"), 1);
  assert.equal(rentalDays("", ""), 1);
});

test("long-term discounts follow rental tiers", () => {
  assert.equal(discountForDays(3), 0);
  assert.equal(discountForDays(4), 0.1);
  assert.equal(discountForDays(15), 0.3);
  assert.equal(discountForDays(31), 0.45);
});

test("itemTotal applies duration and discount", () => {
  assert.equal(itemTotal(1000, 2, 4), 7200);
});

test("estimate includes logistics and service", () => {
  const result = estimate([{ price: 1000, quantity: 2 }], "2026-09-18", "2026-09-20");
  assert.equal(result.subtotal, 6000);
  assert.equal(result.delivery, 5900);
  assert.equal(result.service, 120);
  assert.equal(result.total, 12020);
});
