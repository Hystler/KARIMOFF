import "server-only";

import postgres, { type Sql } from "postgres";

type Row = Record<string, unknown>;
// Query projections are dynamic by design, matching the fluent data API used by the app.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CompatRow = Record<string, any>;
type CompatData = CompatRow & CompatRow[];
type QueryResult = {
  count: number | null;
  data: CompatData | null;
  error: { code?: string; message: string } | null;
};

function compatData(value: unknown) {
  return value as CompatData;
}

const identifierPattern = /^[a-z_][a-z0-9_]*$/;
const allowedTables = new Set([
  "analytics_sale_reconciliations",
  "app_sessions",
  "audit_logs",
  "auth_rate_limits",
  "avatar_assets",
  "cash_register_events",
  "cash_registers",
  "cookie_consents",
  "customer_avatars",
  "customers",
  "economics_settings",
  "evotor_connections",
  "evotor_devices",
  "evotor_documents",
  "evotor_employees",
  "evotor_product_mappings",
  "evotor_products",
  "evotor_receipt_items",
  "evotor_receipts",
  "evotor_stores",
  "evotor_inbound_events",
  "evotor_sync_cursors",
  "evotor_sync_errors",
  "evotor_sync_events",
  "fiscal_receipts",
  "ingredients",
  "inventory_items",
  "inventory_movements",
  "kitchen_sla_settings",
  "leads",
  "legal_consents",
  "loyalty_accounts",
  "loyalty_cards",
  "loyalty_transactions",
  "max_login_challenges",
  "order_inventory_deductions",
  "order_locations",
  "order_notification_deliveries",
  "order_number_counters",
  "order_outbox",
  "order_status_events",
  "oauth_login_attempts",
  "order_item_ingredient_usage",
  "order_item_modifiers",
  "order_items",
  "orders",
  "payment_events",
  "payments",
  "pending_social_identities",
  "product_images",
  "product_ingredients",
  "product_modifier_groups",
  "product_modifier_options",
  "products",
  "production_overheads",
  "production_recipe_expenses",
  "production_recipe_items",
  "production_recipes",
  "production_run_items",
  "production_runs",
  "refunds",
  "refund_items",
  "site_settings",
  "staff_location_access",
  "staff_users",
  "user_identities",
  "vacancies",
  "verification_codes"
]);

let sharedSql: Sql | null = null;

function quoteIdentifier(value: string) {
  if (!identifierPattern.test(value)) {
    throw new Error(`Unsupported SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function tableIdentifier(value: string) {
  if (!allowedTables.has(value)) {
    throw new Error(`Unsupported database table: ${value}`);
  }
  return `public.${quoteIdentifier(value)}`;
}

function normalizeColumns(value = "*") {
  if (value.trim() === "*") return "*";
  return value
    .split(",")
    .map((column) => quoteIdentifier(column.trim()))
    .join(", ");
}

function databaseError(error: unknown) {
  const candidate = error as { code?: string; message?: string };
  return {
    code: candidate?.code,
    message: candidate?.message || "Database request failed."
  };
}

function getSql() {
  if (sharedSql) return sharedSql;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");

  sharedSql = postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 10,
    prepare: false
  });
  return sharedSql;
}

export function getPostgresSql() {
  return getSql();
}

class PostgresQueryBuilder implements PromiseLike<QueryResult> {
  private columns = "*";
  private countRequested = false;
  private filters: Array<{ column?: string; operator: string; value?: unknown; values?: unknown[] }> = [];
  private head = false;
  private limitValue: number | null = null;
  private operation: "delete" | "insert" | "select" | "update" | "upsert" = "select";
  private orders: Array<{ ascending: boolean; column: string }> = [];
  private payload: Row | Row[] | null = null;
  private resultMode: "many" | "maybeSingle" | "single" = "many";
  private returning = false;
  private upsertConflict = "";

  constructor(private readonly table: string) {}

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    this.columns = columns;
    this.countRequested = options?.count === "exact";
    this.head = Boolean(options?.head);
    if (this.operation !== "select") this.returning = true;
    return this;
  }

  insert(payload: Row | Row[]) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload: Row | Row[], options?: { onConflict?: string }) {
    this.operation = "upsert";
    this.payload = payload;
    this.upsertConflict = options?.onConflict || "";
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, operator: "=", value });
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push({ column, operator: ">", value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ column, operator: ">=", value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ column, operator: "in", values });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ column, operator: value === null ? "is null" : "is", value });
    return this;
  }

  or(expression: string) {
    this.filters.push({ operator: "or", value: expression });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ ascending: options?.ascending !== false, column });
    return this;
  }

  limit(value: number) {
    this.limitValue = Math.max(0, Math.trunc(value));
    return this;
  }

  single() {
    this.resultMode = "single";
    return this;
  }

  maybeSingle() {
    this.resultMode = "maybeSingle";
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private whereClause(parameters: unknown[]) {
    if (!this.filters.length) return "";

    const clauses = this.filters.map((filter) => {
      if (filter.operator === "or") {
        const parts = String(filter.value)
          .split(",")
          .map((part) => {
            const [column, operator, rawValue] = part.split(".");
            if (!column || operator !== "eq") throw new Error("Unsupported OR filter.");
            parameters.push(rawValue === "true" ? true : rawValue === "false" ? false : rawValue);
            return `${quoteIdentifier(column)} = $${parameters.length}`;
          });
        return `(${parts.join(" OR ")})`;
      }

      const column = quoteIdentifier(filter.column || "");
      if (filter.operator === "is null") return `${column} IS NULL`;
      if (filter.operator === "in") {
        const values = filter.values ?? [];
        if (!values.length) return "FALSE";
        const placeholders = values.map((value) => {
          parameters.push(value);
          return `$${parameters.length}`;
        });
        return `${column} IN (${placeholders.join(", ")})`;
      }

      parameters.push(filter.value);
      return `${column} ${filter.operator} $${parameters.length}`;
    });

    return ` WHERE ${clauses.join(" AND ")}`;
  }

  private async execute(): Promise<QueryResult> {
    const sql = getSql();
    const parameters: unknown[] = [];

    try {
      if (this.operation === "select") {
        const where = this.whereClause(parameters);
        let exactCount: number | null = null;
        if (this.countRequested) {
          const countRows = await sql.unsafe<{ count: string }[]>(
            `SELECT count(*)::text AS count FROM ${tableIdentifier(this.table)}${where}`,
            parameters as never[]
          );
          exactCount = Number(countRows[0]?.count ?? 0);
          if (this.head) return { count: exactCount, data: null, error: null };
        }

        const order = this.orders.length
          ? ` ORDER BY ${this.orders
              .map((item) => `${quoteIdentifier(item.column)} ${item.ascending ? "ASC" : "DESC"}`)
              .join(", ")}`
          : "";
        const limit = this.limitValue === null ? "" : ` LIMIT ${this.limitValue}`;
        const rows = await sql.unsafe<Row[]>(
          `SELECT ${normalizeColumns(this.columns)} FROM ${tableIdentifier(this.table)}${where}${order}${limit}`,
          parameters as never[]
        );
        return this.shapeRows(rows, exactCount);
      }

      if (this.operation === "delete") {
        const where = this.whereClause(parameters);
        const returning = this.returning ? ` RETURNING ${normalizeColumns(this.columns)}` : "";
        const rows = await sql.unsafe<Row[]>(
          `DELETE FROM ${tableIdentifier(this.table)}${where}${returning}`,
          parameters as never[]
        );
        return this.shapeRows(rows, null);
      }

      if (this.operation === "update") {
        const payload = (this.payload ?? {}) as Row;
        const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
        const assignments = entries.map(([column, value]) => {
          parameters.push(value);
          return `${quoteIdentifier(column)} = $${parameters.length}`;
        });
        const where = this.whereClause(parameters);
        const returning = this.returning ? ` RETURNING ${normalizeColumns(this.columns)}` : "";
        const rows = await sql.unsafe<Row[]>(
          `UPDATE ${tableIdentifier(this.table)} SET ${assignments.join(", ")}${where}${returning}`,
          parameters as never[]
        );
        return this.shapeRows(rows, null);
      }

      const payloadRows = (Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]) as Row[];
      const columns = Array.from(
        new Set(payloadRows.flatMap((row) => Object.keys(row).filter((key) => row[key] !== undefined)))
      );
      const valuesSql = payloadRows
        .map((row) => {
          const placeholders = columns.map((column) => {
            parameters.push(row[column] === undefined ? null : row[column]);
            return `$${parameters.length}`;
          });
          return `(${placeholders.join(", ")})`;
        })
        .join(", ");
      let conflict = "";
      if (this.operation === "upsert") {
        const conflictColumns = this.upsertConflict
          .split(",")
          .map((column) => column.trim())
          .filter(Boolean);
        if (!conflictColumns.length) throw new Error("PostgreSQL upsert requires onConflict.");
        const updates = columns
          .filter((column) => !conflictColumns.includes(column))
          .map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`);
        conflict = ` ON CONFLICT (${conflictColumns.map(quoteIdentifier).join(", ")}) DO ${
          updates.length ? `UPDATE SET ${updates.join(", ")}` : "NOTHING"
        }`;
      }
      const returning = this.returning ? ` RETURNING ${normalizeColumns(this.columns)}` : "";
      const rows = await sql.unsafe<Row[]>(
        `INSERT INTO ${tableIdentifier(this.table)} (${columns.map(quoteIdentifier).join(", ")}) VALUES ${valuesSql}${conflict}${returning}`,
        parameters as never[]
      );
      return this.shapeRows(rows, null);
    } catch (error) {
      return { count: null, data: null, error: databaseError(error) };
    }
  }

  private shapeRows(rows: Row[], count: number | null): QueryResult {
    if (this.resultMode === "single") {
      if (rows.length !== 1) {
        return { count, data: null, error: { code: "PGRST116", message: "Expected one row." } };
      }
      return { count, data: compatData(rows[0]), error: null };
    }
    if (this.resultMode === "maybeSingle") {
      if (rows.length > 1) {
        return { count, data: null, error: { code: "PGRST116", message: "Expected at most one row." } };
      }
      return { count, data: rows[0] ? compatData(rows[0]) : null, error: null };
    }
    return { count, data: compatData(rows), error: null };
  }
}

export class PostgresCompatClient {
  from(table: string) {
    return new PostgresQueryBuilder(table);
  }

  async rpc(name: string, args: Row = {}): Promise<QueryResult> {
    if (!identifierPattern.test(name)) {
      return { count: null, data: null, error: { message: "Unsupported database function." } };
    }

    const sql = getSql();
    const parameters = Object.values(args);
    const namedArguments = Object.keys(args)
      .map((key, index) => `${quoteIdentifier(key)} => $${index + 1}`)
      .join(", ");

    try {
      const rows = await sql.unsafe<Row[]>(
        `SELECT * FROM public.${quoteIdentifier(name)}(${namedArguments})`,
        parameters as never[]
      );
      if (rows.length === 1) {
        const keys = Object.keys(rows[0]);
        if (keys.length === 1 && keys[0] === name) {
          return { count: null, data: compatData(rows[0][name]), error: null };
        }
      }
      return { count: null, data: compatData(rows), error: null };
    } catch (error) {
      return { count: null, data: null, error: databaseError(error) };
    }
  }
}

export function createPostgresServerClient() {
  if (!process.env.DATABASE_URL) return null;
  return new PostgresCompatClient();
}
