import { spawnSync } from "node:child_process";
import { getSupabaseMigrationDbUrl, rootDir } from "./supabase-env.mjs";

const dbUrl = getSupabaseMigrationDbUrl();

if (!dbUrl) {
  console.error("SUPABASE_DB_URL is missing. Add it to .env.local before listing migrations.");
  process.exit(1);
}

const result = spawnSync("supabase", ["migration", "list", "--db-url", dbUrl], {
  cwd: rootDir,
  stdio: "inherit",
  env: {
    ...process.env,
    DO_NOT_TRACK: "1"
  }
});

process.exit(result.status ?? 1);
