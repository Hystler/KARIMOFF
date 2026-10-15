import assert from "node:assert/strict";
import test from "node:test";
import config from "../next.config.mjs";

test("OSM tiles are allowed only on the administrative delivery map document", async () => {
  const headers = await config.headers();
  const csp = (rule) => rule.headers.find(row => row.key === "Content-Security-Policy")?.value;
  const general = headers.find(row => row.source === "/(.*)");
  const map = headers.find(row => row.source === "/admin/delivery-zone");
  assert.ok(general && map);
  assert.doesNotMatch(csp(general), /tile\.openstreetmap\.org/);
  assert.match(csp(map), /img-src [^;]*https:\/\/tile\.openstreetmap\.org/);
  assert.match(csp(map), /connect-src 'self';/);
  assert.match(csp(map), /frame-ancestors 'none'/);
});
