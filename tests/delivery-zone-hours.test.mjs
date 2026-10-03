import assert from "node:assert/strict";
import { test } from "node:test";
import { assessDeliveryZone, distanceMeters, isInsidePolygon } from "../src/lib/delivery/geo.ts";
import { getDeliveryAcceptanceState, isDeliveryAcceptingAt } from "../src/lib/delivery/hours.ts";

const center = [38.055708, 55.909221];
const excludedArea = {
  type: "Polygon",
  coordinates: [[[38.04, 55.90], [38.06, 55.90], [38.06, 55.92], [38.04, 55.92], [38.04, 55.90]]]
};

function pointAtMeters(distance) {
  const radians = distance / (2 * 6_371_008.8);
  const longitudeDelta = 2 * Math.asin(Math.sin(radians) / Math.cos(center[1] * Math.PI / 180));
  return [center[0] + longitudeDelta * 180 / Math.PI, center[1]];
}

test("zone uses straight-line distance with an inclusive 3km boundary", () => {
  for (const distance of [1_000, 2_990, 2_999, 3_000]) {
    const result = assessDeliveryZone({ address: pointAtMeters(distance), center, radiusMeters: 3_000, excludedAreas: [] });
    assert.equal(result.available, true, `${distance}m should be within the zone`);
    assert.ok(Math.abs(result.distanceMeters - distance) <= 1);
  }
  for (const distance of [3_001, 3_010, 20_000]) {
    const result = assessDeliveryZone({ address: pointAtMeters(distance), center, radiusMeters: 3_000, excludedAreas: [] });
    assert.equal(result.available, false);
    assert.equal(result.withinRadius, false);
  }
});

test("excluded polygon blocks points inside and on its border even within radius", () => {
  const inside = [38.05, 55.91];
  const boundary = [38.04, 55.91];
  assert.equal(distanceMeters(center, inside) < 3_000, true);
  assert.equal(isInsidePolygon(inside, excludedArea), true);
  assert.equal(isInsidePolygon(boundary, excludedArea), true);
  assert.equal(isInsidePolygon([38.07, 55.91], excludedArea), false);
  assert.equal(isInsidePolygon([38.05, 55.93], excludedArea), false);
  assert.equal(assessDeliveryZone({ address: inside, center, radiusMeters: 3_000, excludedAreas: [{ geometry: excludedArea }] }).available, false);
  assert.equal(assessDeliveryZone({ address: boundary, center, radiusMeters: 3_000, excludedAreas: [{ geometry: excludedArea }] }).excluded, true);
});

test("invalid coordinates fail closed", () => {
  assert.throws(() => assessDeliveryZone({ address: [181, 91], center, radiusMeters: 3_000, excludedAreas: [] }), RangeError);
});

test("delivery acceptance uses inclusive Moscow-local opening and closing times", () => {
  const at = (utc) => isDeliveryAcceptingAt(new Date(utc));
  assert.equal(at("2026-01-15T07:59:00Z"), false); // 10:59 MSK
  assert.equal(at("2026-01-15T08:00:00Z"), true); // 11:00
  assert.equal(at("2026-01-15T17:29:00Z"), true); // 20:29
  assert.equal(at("2026-01-15T17:30:00Z"), true); // 20:30
  assert.equal(at("2026-01-15T17:31:00Z"), false); // 20:31
});

test("delivery acceptance identifies time before opening and after closing", () => {
  assert.equal(getDeliveryAcceptanceState(new Date("2026-01-15T07:59:00Z")), "before");
  assert.equal(getDeliveryAcceptanceState(new Date("2026-01-15T17:31:00Z")), "after");
});
