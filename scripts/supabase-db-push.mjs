import { spawnSync } from "node:child_process";
import { getSupabaseMigrationDbUrl, rootDir } from "./supabase-env.mjs";

const dbUrl = getSupabaseMigrationDbUrl();

if (!dbUrl) {
  console.error(
    "SUPABASE_DB_URL is missing. Add it to .env.local or run `supabase login` + `supabase link` and use npm run db:push."
  );
  process.exit(1);
}

const args = ["db", "push", "--db-url", dbUrl, ...process.argv.slice(2)];
const result = spawnSync("supabase", args, {
  cwd: rootDir,
  stdio: "inherit",
  env: {
    ...process.env,
    DO_NOT_TRACK: "1"
  }
});

process.exit(result.status ?? 1);
