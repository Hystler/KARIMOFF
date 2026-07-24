import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
export const rootDir = path.resolve(path.dirname(__filename), "..");
const envPath = path.join(rootDir, ".env.local");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        const key = line.slice(0, separatorIndex).trim();
        const rawValue = line.slice(separatorIndex + 1).trim();
        const value = rawValue.replace(/^['"]|['"]$/g, "");
        return [key, value];
      })
  );
}

export function getSupabaseDbUrl() {
  const fileEnv = parseEnvFile(envPath);
  return process.env.SUPABASE_DB_URL || fileEnv.SUPABASE_DB_URL || "";
}

export function getSupabaseMigrationDbUrl() {
  const dbUrl = getSupabaseDbUrl();

  try {
    const parsed = new URL(dbUrl);

    if (parsed.hostname.endsWith(".pooler.supabase.com") && parsed.port === "6543") {
      parsed.port = "5432";
    }

    return parsed.toString();
  } catch {
    return dbUrl;
  }
}
