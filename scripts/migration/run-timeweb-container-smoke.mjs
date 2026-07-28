import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function readEnv(path) {
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[trimmed.slice(0, separator).trim()] = value;
  }
  return result;
}

const sourcePath = process.env.SOURCE_ENV_PATH || ".env.local";
const migrationPath =
  process.env.MIGRATION_ENV_PATH || "/Users/akimkovalenko/Desktop/KARIMOFF-migration.env";
const source = readEnv(sourcePath);
const migration = readEnv(migrationPath);
const databaseUrl =
  migration.TIMEWEB_APP_DATABASE_URL_PUBLIC || migration.TARGET_DATABASE_URL;

if (!databaseUrl) {
  console.error("Timeweb application DATABASE_URL is missing.");
  process.exit(2);
}

const containerName = `karimoff-migration-smoke-${process.pid}`;
const hostPort = process.env.SMOKE_PORT || "3012";
const workDir = mkdtempSync(join(tmpdir(), "karimoff-container-smoke-"));
const envPath = join(workDir, "runtime.env");
const runtime = {
  ...source,
  ...migration,
  DATABASE_PROVIDER: "postgres",
  DATABASE_URL: databaseUrl,
  HOSTNAME: "0.0.0.0",
  PAYMENTS_ENABLED: "false",
  PORT: "3000",
  STORAGE_PROVIDER: "s3"
};

writeFileSync(
  envPath,
  `${Object.entries(runtime)
    .filter(([, value]) => value !== undefined && !String(value).includes("\n"))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`,
  { mode: 0o600 }
);

function docker(args, options = {}) {
  return spawnSync("docker", args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });
}

try {
  const started = docker([
    "run",
    "--rm",
    "--detach",
    "--name",
    containerName,
    "--env-file",
    envPath,
    "--publish",
    `127.0.0.1:${hostPort}:3000`,
    "karimoff"
  ]);
  if (started.status !== 0) process.exit(started.status ?? 1);

  const routes = ["/", "/menu", "/login", "/careers"];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const results = await Promise.all(
        routes.map(async (route) => {
          const response = await fetch(`http://127.0.0.1:${hostPort}${route}`);
          return { route, status: response.status };
        })
      );
      if (results.every(({ status }) => status === 200)) {
        for (const result of results) console.log(`${result.route}: HTTP ${result.status}`);
        process.exitCode = 0;
        break;
      }
    } catch {
      // The standalone server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (process.exitCode !== 0) {
    console.error("Container HTTP smoke did not become ready.");
    process.exitCode = 1;
  }
} finally {
  docker(["rm", "--force", containerName], { capture: true });
  rmSync(workDir, { recursive: true, force: true });
}
