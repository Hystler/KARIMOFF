import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const phoneModuleUrl = pathToFileURL(
  new URL("../src/lib/phone.ts", import.meta.url).pathname
).href;

function runPhoneCases() {
  const script = `
    const phone = await import(${JSON.stringify(phoneModuleUrl)});
    const values = [
      "9991234567",
      "89991234567",
      "+79991234567",
      "7 999 123 45 67",
      "(999) 123-45-67"
    ];
    console.log(JSON.stringify(values.map((value) => ({
      normalized: phone.normalizeRussianPhone(value),
      formatted: phone.formatRussianPhoneInput(value)
    }))));
  `;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("Russian phone formats converge to one stored and displayed value", () => {
  const results = runPhoneCases();

  for (const result of results) {
    assert.equal(result.normalized, "+79991234567");
    assert.equal(result.formatted, "+7 (999) 123-45-67");
  }
});
