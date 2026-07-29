import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const proxySource = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const maintenanceSource = readFileSync(
  new URL("../src/lib/maintenance.ts", import.meta.url),
  "utf8"
);

test("maintenance mode keeps reads available and blocks every write method centrally", () => {
  assert.match(maintenanceSource, /method === "GET"/);
  assert.match(maintenanceSource, /method === "HEAD"/);
  assert.match(proxySource, /isReadOnlyRequest\(request\.method\)/);
  assert.match(proxySource, /status: 503/);
  assert.match(proxySource, /Retry-After/);
});

test("maintenance mode is visible and disabled unless explicitly enabled", () => {
  assert.match(maintenanceSource, /process\.env\.MAINTENANCE_MODE === "true"/);
  assert.match(layoutSource, /maintenanceMode=\{process\.env\.MAINTENANCE_MODE === "true"\}/);
  assert.match(
    maintenanceSource,
    /Сервис временно обновляется\. Попробуйте снова через несколько минут\./
  );
});
