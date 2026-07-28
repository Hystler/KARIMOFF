import { readFileSync } from "node:fs";
import postgres from "postgres";

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

const apply = process.argv.includes("--apply");
const env = readEnv(
  process.env.MIGRATION_ENV_PATH || "/Users/akimkovalenko/Desktop/KARIMOFF-migration.env"
);
const mapping = JSON.parse(
  readFileSync(
    process.env.STORAGE_MAP_PATH ||
      "/Users/akimkovalenko/Desktop/karimoff-storage-url-map.json",
    "utf8"
  )
);

if (!env.TARGET_DATABASE_URL) throw new Error("TARGET_DATABASE_URL is missing.");
const sql = postgres(env.TARGET_DATABASE_URL, { max: 1, prepare: false });
const fields = [
  ["products", "image_url"],
  ["product_images", "image_url"],
  ["avatar_assets", "image_url"],
  ["site_settings", "home_hero_image_url"],
  ["site_settings", "menu_hero_image_url"],
  ["site_settings", "business_hero_image_url"],
  ["site_settings", "careers_hero_image_url"],
  ["site_settings", "franchise_hero_image_url"],
  ["site_settings", "about_hero_image_url"]
];

let matches = 0;
let updates = 0;

try {
  await sql.begin(async (transaction) => {
    for (const item of mapping.mappings) {
      for (const [table, column] of fields) {
        const countRows = await transaction.unsafe(
          `SELECT count(*)::int AS count FROM public."${table}" WHERE "${column}" = $1`,
          [item.old_url]
        );
        matches += Number(countRows[0]?.count ?? 0);
        if (apply) {
          const result = await transaction.unsafe(
            `UPDATE public."${table}" SET "${column}" = $1 WHERE "${column}" = $2`,
            [item.new_url, item.old_url]
          );
          updates += Number(result.count ?? 0);
        }
      }
    }

    if (!apply) {
      throw new Error("DRY_RUN_ROLLBACK");
    }
  });
} catch (error) {
  if (!(error instanceof Error) || error.message !== "DRY_RUN_ROLLBACK") throw error;
}

await sql.end();
console.log(apply ? `Updated ${updates} stored URLs.` : `Dry run: ${matches} stored URLs would change.`);
