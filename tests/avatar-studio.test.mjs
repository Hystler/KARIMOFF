import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const studio = readFileSync(join(root, "src/components/avatar/Avatar3DStudio.tsx"), "utf8");
const builder = readFileSync(join(root, "src/components/avatar/AvatarBuilder.tsx"), "utf8");

test("avatar studio starts front-facing and cannot rotate into a broken profile", () => {
  assert.match(studio, /controls\.autoRotate = false/);
  assert.match(studio, /controls\.minAzimuthAngle = -0\.4/);
  assert.match(studio, /controls\.maxAzimuthAngle = 0\.4/);
  assert.doesNotMatch(studio, /autoRotate = !paused/);
});

test("avatar editor uses a stable responsive control grid without scene copy overlays", () => {
  assert.match(builder, /gridTemplateColumns: "repeat\(3, minmax\(0, 1fr\)\)"/);
  assert.doesNotMatch(builder, /Живой 3D-персонаж/);
  assert.doesNotMatch(builder, /KARIMOFF Avatar 2\.0/);
});
