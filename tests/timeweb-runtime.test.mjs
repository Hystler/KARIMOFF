import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

test("production runtime has no Supabase client, URL, env, or provider fallback", () => {
  const runtimeFiles = [
    ...sourceFiles(join(process.cwd(), "src")).filter((path) =>
      [".ts", ".tsx", ".js", ".mjs"].includes(extname(path))
    ),
    join(process.cwd(), "next.config.mjs"),
    join(process.cwd(), "Dockerfile")
  ];

  for (const path of runtimeFiles) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /@supabase\/|supabase\.co|SUPABASE_|DATABASE_PROVIDER|STORAGE_PROVIDER/i, path);
  }

  const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
  assert.doesNotMatch(packageJson, /@supabase\/supabase-js/);
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
  const allowedFiles = new Set(readFileSync(".dockerignore", "utf8").split(/\r?\n/));
  const names = [...runner.matchAll(/name:\s*"(\d{14}_[a-z0-9_]+)"/g)].map(match => match[1]);
  assert.ok(names.length > 0);
  for (const name of names) {
    const file = `supabase/migrations/${name}.sql`;
    assert.ok(readFileSync(file, "utf8").trim(), file);
    assert.ok(allowedFiles.has(`!${file}`), `Docker build context excludes ${file}`);
    assert.ok(dockerfile.includes(`COPY --from=builder --chown=nextjs:nodejs /app/${file} ./${file}`), `Runtime image omits ${file}`);
  }
});
