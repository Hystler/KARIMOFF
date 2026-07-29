import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

function parseDotEnv(path) {
  const result = {};
  const source = readFileSync(path, "utf8");

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  return result;
}

function envValue(name, envPath) {
  if (process.env[name]) return process.env[name];
  return parseDotEnv(envPath)[name] ?? "";
}

function postgresEnv(databaseUrl) {
  const url = new URL(databaseUrl);
  const sslMode = url.searchParams.get("sslmode") || "require";

  return [
    `PGHOST=${url.hostname}`,
    `PGPORT=${url.port || "5432"}`,
    `PGUSER=${decodeURIComponent(url.username)}`,
    `PGPASSWORD=${decodeURIComponent(url.password)}`,
    `PGDATABASE=${url.pathname.replace(/^\//, "") || "postgres"}`,
    `PGSSLMODE=${sslMode}`
  ].join("\n");
}

function runDocker({ databaseUrl, args, mounts = [] }) {
  const workDir = resolve(tmpdir(), `karimoff-pg-${process.pid}-${Date.now()}`);
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const envFile = resolve(workDir, "postgres.env");
  writeFileSync(envFile, `${postgresEnv(databaseUrl)}\n`, { mode: 0o600 });

  const dockerArgs = ["run", "--rm", "--env-file", envFile];
  for (const mount of mounts) {
    dockerArgs.push("-v", `${mount.host}:${mount.container}`);
  }
  dockerArgs.push("postgres:17-alpine", ...args);

  try {
    const result = spawnSync("docker", dockerArgs, {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"]
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result.status ?? 1;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

const [command, ...commandArgs] = process.argv.slice(2);
const sourceEnvPath = process.env.MIGRATION_ENV_PATH || ".env.local";
const databaseUrlName = process.env.DATABASE_URL_NAME || "SUPABASE_DB_URL";
const databaseUrl = envValue(databaseUrlName, sourceEnvPath);

if (!databaseUrl) {
  console.error(`${databaseUrlName} is missing in ${sourceEnvPath}.`);
  process.exit(2);
}

if (command === "query") {
  const sql = commandArgs.join(" ");
  if (!sql) {
    console.error("Usage: postgres-container.mjs query <sql>");
    process.exit(2);
  }
  process.exit(
    runDocker({
      databaseUrl,
      args: ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql]
    })
  );
}

if (command === "query-file") {
  const outputPath = resolve(commandArgs[0] || "");
  const sql = commandArgs.slice(1).join(" ");
  if (!commandArgs[0] || !sql) {
    console.error("Usage: postgres-container.mjs query-file <output.txt> <sql>");
    process.exit(2);
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = "";
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  const status = runDocker({
    databaseUrl,
    args: ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql]
  });
  process.stdout.write = originalWrite;
  if (status === 0) {
    writeFileSync(outputPath, output, { mode: 0o600 });
  }
  process.exit(status);
}

if (command === "dump") {
  const outputPath = resolve(commandArgs[0] || "");
  if (!commandArgs[0]) {
    console.error("Usage: postgres-container.mjs dump <output.dump>");
    process.exit(2);
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  process.exit(
    runDocker({
      databaseUrl,
      mounts: [{ host: dirname(outputPath), container: "/backup" }],
      args: [
        "pg_dump",
        "--format=custom",
        "--schema=public",
        "--no-owner",
        "--no-privileges",
        "--file",
        `/backup/${basename(outputPath)}`
      ]
    })
  );
}

if (command === "schema") {
  const outputPath = resolve(commandArgs[0] || "");
  if (!commandArgs[0]) {
    console.error("Usage: postgres-container.mjs schema <output.sql>");
    process.exit(2);
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  process.exit(
    runDocker({
      databaseUrl,
      mounts: [{ host: dirname(outputPath), container: "/backup" }],
      args: [
        "pg_dump",
        "--schema-only",
        "--schema=public",
        "--no-owner",
        "--no-privileges",
        "--file",
        `/backup/${basename(outputPath)}`
      ]
    })
  );
}

if (command === "data") {
  const outputPath = resolve(commandArgs[0] || "");
  if (!commandArgs[0]) {
    console.error("Usage: postgres-container.mjs data <output.sql>");
    process.exit(2);
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  process.exit(
    runDocker({
      databaseUrl,
      mounts: [{ host: dirname(outputPath), container: "/backup" }],
      args: [
        "pg_dump",
        "--data-only",
        "--schema=public",
        "--no-owner",
        "--no-privileges",
        "--file",
        `/backup/${basename(outputPath)}`
      ]
    })
  );
}

if (command === "objects") {
  const inputPath = resolve(commandArgs[0] || "");
  const outputPath = resolve(commandArgs[1] || "");
  if (!commandArgs[0] || !commandArgs[1]) {
    console.error("Usage: postgres-container.mjs objects <input.dump> <output.txt>");
    process.exit(2);
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${dirname(inputPath)}:/backup:ro`,
      "postgres:17-alpine",
      "pg_restore",
      "--list",
      `/backup/${basename(inputPath)}`
    ],
    { encoding: "utf8" }
  );
  if (result.status === 0) {
    writeFileSync(outputPath, result.stdout, { mode: 0o600 });
  } else if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exit(result.status ?? 1);
}

if (command === "replace-data") {
  const inputPath = resolve(commandArgs[0] || "");
  if (!commandArgs[0]) {
    console.error("Usage: postgres-container.mjs replace-data <input-data.sql>");
    process.exit(2);
  }

  const transactionName = `.karimoff-replace-${process.pid}-${Date.now()}.sql`;
  const transactionPath = resolve(dirname(inputPath), transactionName);
  const sourceData = readFileSync(inputPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("\\restrict ") && !line.startsWith("\\unrestrict "))
    .join("\n");
  const transactionSql = `\\set ON_ERROR_STOP on
BEGIN;
DO $do$
DECLARE
  statement text;
BEGIN
  SELECT
    'TRUNCATE TABLE ' ||
    string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename) ||
    ' RESTART IDENTITY CASCADE'
  INTO statement
  FROM pg_tables
  WHERE schemaname = 'public';

  IF statement IS NOT NULL THEN
    EXECUTE statement;
  END IF;
END
$do$;
${sourceData}
COMMIT;
`;
  writeFileSync(transactionPath, transactionSql, { mode: 0o600 });

  try {
    const targetDatabase = new URL(databaseUrl).pathname.replace(/^\//, "") || "postgres";
    process.exitCode = runDocker({
      databaseUrl,
      mounts: [{ host: dirname(inputPath), container: "/backup:ro" }],
      args: [
        "psql",
        "-X",
        "--dbname",
        targetDatabase,
        "--file",
        `/backup/${transactionName}`
      ]
    });
  } finally {
    rmSync(transactionPath, { force: true });
  }
  process.exit(process.exitCode);
}

if (command === "restore") {
  const inputPath = resolve(commandArgs[0] || "");
  if (!commandArgs[0]) {
    console.error("Usage: postgres-container.mjs restore <input.dump>");
    process.exit(2);
  }
  const inputName = basename(inputPath);
  const restoreListName = `.karimoff-restore-${process.pid}.list`;
  const restoreListPath = resolve(dirname(inputPath), restoreListName);
  const listResult = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${dirname(inputPath)}:/backup`,
      "postgres:17-alpine",
      "pg_restore",
      "--list",
      `/backup/${inputName}`
    ],
    { encoding: "utf8" }
  );

  if (listResult.status !== 0) {
    if (listResult.stderr) process.stderr.write(listResult.stderr);
    process.exit(listResult.status ?? 1);
  }

  const filteredList = listResult.stdout
    .split(/\r?\n/)
    .filter(
      (line) =>
        !line.includes(" POLICY ") &&
        !line.includes(" SCHEMA - public ") &&
        !line.includes(" COMMENT - SCHEMA public ")
    )
    .join("\n");
  writeFileSync(restoreListPath, `${filteredList}\n`, { mode: 0o600 });

  try {
    const targetDatabase = new URL(databaseUrl).pathname.replace(/^\//, "") || "postgres";
    process.exitCode = runDocker({
      databaseUrl,
      mounts: [{ host: dirname(inputPath), container: "/backup" }],
      args: [
        "pg_restore",
        "--dbname",
        targetDatabase,
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        `--use-list=/backup/${restoreListName}`,
        `/backup/${inputName}`
      ]
    });
  } finally {
    rmSync(restoreListPath, { force: true });
  }
  process.exit(process.exitCode);
}

console.error("Commands: query, query-file, dump, schema, data, objects, replace-data, restore");
process.exit(2);
