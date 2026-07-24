import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { getSupabaseMigrationDbUrl, rootDir } from "./supabase-env.mjs";

const dbUrl = getSupabaseMigrationDbUrl();

if (!dbUrl) {
  console.error("SUPABASE_DB_URL is missing. Add it to .env.local before running database tests.");
  process.exit(1);
}

const result = spawnSync(
  "supabase",
  [
    "db",
    "query",
    "--db-url",
    dbUrl,
    "--file",
    join(rootDir, "supabase/tests/hardening.sql")
  ],
  {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      DO_NOT_TRACK: "1"
    }
  }
);

process.exit(result.status ?? 1);
