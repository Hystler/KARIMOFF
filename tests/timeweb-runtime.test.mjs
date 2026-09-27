import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("PostgreSQL driver is a production dependency", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
  assert.ok(packageJson.dependencies.postgres);
});

test("database and object storage are server-only Timeweb adapters", () => {
  const database = readFileSync(join(process.cwd(), "src/lib/database/server.ts"), "utf8");
  const storage = readFileSync(join(process.cwd(), "src/lib/storage-images.ts"), "utf8");

  assert.match(database, /createPostgresServerClient/);
  assert.match(database, /process\.env\.DATABASE_URL/);
  assert.match(storage, /uploadS3Object/);
  assert.doesNotMatch(storage, /\.storage\.from/);
});

test("Timeweb keeps standalone output while Vercel uses its native build adapter", () => {
  const config = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");

  assert.match(config, /output: process\.env\.VERCEL \? undefined : "standalone"/);
});

test("every startup migration is included in the Timeweb runtime image", () => {
  const runner = readFileSync("scripts/apply-runtime-schema-migrations.mjs", "utf8");
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const dockerignore = readFileSync(".dockerignore", "utf8");
  const names = [...runner.matchAll(/name:\s*"(\d{14}_[a-z0-9_]+)"/g)].map(match => match[1]);
  assert.ok(names.length > 0);
  assert.match(dockerignore, /!database\/migrations\/\*\.sql/);
  assert.match(dockerfile, /\/app\/database\/migrations\/ \.\/database\/migrations\//);
  for (const name of names) {
    const file = `database/migrations/${name}.sql`;
    assert.ok(readFileSync(file, "utf8").trim(), file);
  }
});
