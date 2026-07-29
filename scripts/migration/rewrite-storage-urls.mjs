import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";

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

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsupported identifier: ${value}`);
  }
  return `"${value}"`;
}

const apply = process.argv.includes("--apply");
const env = readEnv(
  process.env.MIGRATION_ENV_PATH || "/Users/akimkovalenko/Desktop/KARIMOFF-migration.env"
);
const mapping = JSON.parse(
  readFileSync(
    process.env.STORAGE_MAP_PATH ||
      "/Users/akimkovalenko/Desktop/karimoff-final-storage-url-map.json",
    "utf8"
  )
);
const reportPath =
  process.env.STORAGE_REWRITE_REPORT_PATH ||
  "/Users/akimkovalenko/Desktop/karimoff-final-storage-rewrite-report.json";

if (!env.TARGET_DATABASE_URL) throw new Error("TARGET_DATABASE_URL is missing.");
const sql = postgres(env.TARGET_DATABASE_URL, { max: 1, prepare: false });
let matches = 0;
let updates = 0;
const fields = [];

try {
  const columns = await sql`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema = 'public'
      and data_type in ('text', 'character varying', 'character', 'json', 'jsonb')
    order by table_name, ordinal_position
  `;

  await sql.begin(async (transaction) => {
    for (const column of columns) {
      const table = quoteIdentifier(column.table_name);
      const field = quoteIdentifier(column.column_name);
      let fieldMatches = 0;
      let fieldUpdates = 0;

      for (const item of mapping.mappings) {
        const countRows = await transaction.unsafe(
          `SELECT count(*)::int AS count
           FROM public.${table}
           WHERE ${field}::text LIKE '%' || $1 || '%'`,
          [item.old_url]
        );
        const count = Number(countRows[0]?.count ?? 0);
        matches += count;
        fieldMatches += count;

        if (apply && count > 0) {
          const expression =
            column.data_type === "json" || column.data_type === "jsonb"
              ? `replace(${field}::text, $2, $1)::${column.data_type}`
              : `replace(${field}, $2, $1)`;
          const result = await transaction.unsafe(
            `UPDATE public.${table}
             SET ${field} = ${expression}
             WHERE ${field}::text LIKE '%' || $2 || '%'`,
            [item.new_url, item.old_url]
          );
          const changed = Number(result.count ?? 0);
          updates += changed;
          fieldUpdates += changed;
        }
      }

      const remainingRows = await transaction.unsafe(
        `SELECT count(*)::int AS count
         FROM public.${table}
         WHERE ${field}::text ILIKE '%supabase.co%'`
      );
      const remaining = Number(remainingRows[0]?.count ?? 0);

      if (fieldMatches > 0 || fieldUpdates > 0 || remaining > 0) {
        fields.push({
          column: column.column_name,
          data_type: column.data_type,
          matches: fieldMatches,
          remaining_supabase_rows: remaining,
          table: column.table_name,
          updates: fieldUpdates
        });
      }
    }

    if (!apply) {
      throw new Error("DRY_RUN_ROLLBACK");
    }
  });
} catch (error) {
  if (!(error instanceof Error) || error.message !== "DRY_RUN_ROLLBACK") throw error;
} finally {
  await sql.end();
}

const remaining = fields.reduce(
  (sum, field) => sum + field.remaining_supabase_rows,
  0
);
const report = {
  applied: apply,
  generated_at: new Date().toISOString(),
  mapped_url_count: mapping.mappings.length,
  matches,
  updates,
  remaining_supabase_rows: remaining,
  fields
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
chmodSync(reportPath, 0o600);

console.log(
  apply
    ? `Updated ${updates} rows; ${remaining} rows still contain Supabase URLs.`
    : `Dry run: ${matches} rows would change; ${remaining} rows currently contain Supabase URLs.`
);

if (apply && remaining > 0) process.exit(1);
