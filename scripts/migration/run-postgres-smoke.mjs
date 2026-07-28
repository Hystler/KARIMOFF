import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

function readEnv(path) {
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    result[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return result;
}

const command = process.argv[2];
const args = process.argv.slice(3);
if (!command) {
  console.error("Usage: run-postgres-smoke.mjs <command> [...args]");
  process.exit(2);
}

const source = readEnv(process.env.SOURCE_ENV_PATH || ".env.local");
const migration = readEnv(
  process.env.MIGRATION_ENV_PATH || "/Users/akimkovalenko/Desktop/KARIMOFF-migration.env"
);
const appDatabaseUrl =
  migration.TIMEWEB_APP_DATABASE_URL_PUBLIC || migration.TARGET_DATABASE_URL;
if (!appDatabaseUrl) {
  console.error("Timeweb application DATABASE_URL is not configured.");
  process.exit(2);
}
const child = spawn(command, args, {
  env: {
    ...process.env,
    ...source,
    ...migration,
    DATABASE_PROVIDER: "postgres",
    DATABASE_URL: appDatabaseUrl,
    PAYMENTS_ENABLED: "false",
    STORAGE_PROVIDER: "s3"
  },
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
