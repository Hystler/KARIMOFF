import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateDeliveryFee } from "../src/lib/delivery-pricing.ts";

test("delivery costs 200 rubles below the free-delivery threshold", () => {
  assert.equal(calculateDeliveryFee(1), 200);
  assert.equal(calculateDeliveryFee(200), 200);
  assert.equal(calculateDeliveryFee(0), 200);
  assert.equal(calculateDeliveryFee(2_499), 200);
});

test("delivery is free at and above 2,500 rubles", () => {
  assert.equal(calculateDeliveryFee(2_500), 0);
  assert.equal(calculateDeliveryFee(2_501), 0);
});

test("the fee decision is based on the supplied post-discount merchandise subtotal", () => {
  const discountedSubtotal = 2_600 - 150;
  assert.equal(calculateDeliveryFee(discountedSubtotal), 200);
  assert.equal(calculateDeliveryFee(2_600), 0);
});
