import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { z } from "zod";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const schema = loadTypeScript("src/lib/avatar-schema.ts", { zod: { z } });
const { avatarPresets, isSameAvatar } = loadTypeScript("src/lib/avatar-presets.ts", { "@/lib/avatar-schema": schema });
const builder = readFileSync("src/components/avatar/AvatarBuilder.tsx", "utf8");

test("all ten ready-made pandas round-trip through the existing saved avatar format", () => {
  assert.equal(avatarPresets.length, 10);
  assert.equal(new Set(avatarPresets.map((preset) => preset.id)).size, 10);
  assert.equal(new Set(avatarPresets.map((preset) => JSON.stringify(preset.avatar))).size, 10);
  for (const preset of avatarPresets) {
    const saved = schema.avatarSchema.parse(JSON.parse(JSON.stringify(preset.avatar)));
    assert.ok(isSameAvatar(saved, preset.avatar));
    assert.deepEqual(Object.keys(saved).sort(), [...schema.avatarAssetTypes].sort());
    for (const key of schema.avatarAssetTypes) {
      assert.ok(schema.avatarOptions[key].some((option) => option.value === saved[key]));
    }
  }
});

test("legacy saved pandas retain all parts until a new preset is explicitly selected", () => {
  const legacy = { base: "panda_round", eyes: "serious", mouth: "neutral", accessory: "burger_pin", clothes: "apron_orange", background: "grill" };
  const saved = schema.avatarSchema.parse(legacy);
  assert.deepEqual(saved, legacy);
  assert.ok(!avatarPresets.some((preset) => isSameAvatar(preset.avatar, saved)));
  assert.ok(isSameAvatar(saved, { ...saved }));
  assert.ok(!isSameAvatar(saved, { ...saved, background: "clean" }));
  assert.match(builder, /setAvatar\(initialAvatar\)/);
  assert.match(builder, /name=\{key\} value=\{avatar\[key\]\}/);
});

test("preset picker uses native keyboard radio controls without loading a 3D studio", () => {
  assert.match(builder, /<fieldset>/);
  assert.match(builder, /type="radio"/);
  assert.match(builder, /AvatarPreview avatar=\{preset.avatar\} size="tile"/);
  assert.doesNotMatch(builder, /Avatar3DStudio|next\/dynamic|activeSection|shuffleAvatar/);
});
