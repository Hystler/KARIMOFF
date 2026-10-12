import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = process.cwd();
const id = "11111111-1111-4111-8111-111111111111";
const owner = { id, role: "owner", legacy: false };
const config = {
  ORDER_STATUS_NOTIFICATIONS_ENABLED: "true", APP_ORIGIN: "https://example.test",
  TELEGRAM_ORDER_STATUS_NOTIFICATIONS_ENABLED: "true", MAX_ORDER_STATUS_NOTIFICATIONS_ENABLED: "true",
  TELEGRAM_ORDER_STATUS_NOTIFICATIONS_MODE: "live",
  TELEGRAM_ORDER_STATUS_NOTIFICATIONS_NOT_BEFORE: "2026-01-01T00:00:00Z",
  MAX_ORDER_STATUS_NOTIFICATIONS_NOT_BEFORE: "2026-01-01T00:00:00Z",
  TELEGRAM_BOT_TOKEN: "test-telegram-secret", MAX_BOT_TOKEN: "test-max-secret"
};

// Execute the actual TypeScript in memory. No real credentials, network, DB or emitted files.
export function notificationHarness(options = {}) {
  const env = { ...config, ...options.env };
  const calls = [];
  const logs = [];
  const timers = [];
  const cache = new Map();
  let connections = 0;
  let transactions = 0;
  const sql = (strings, ...values) => {
    let query = strings[0];
    const parameters = [];
    values.forEach((value, index) => {
      query += value?.query ?? "?";
      parameters.push(...(value?.parameters ?? [value]));
      query += strings[index + 1];
    });
    const statement = { query: query.replace(/\s+/g, " ").trim(), parameters };
    return {
      ...statement,
      then: (onFulfilled, onRejected) => Promise.resolve().then(() => {
        calls.push(statement);
        return options.query ? options.query(statement, calls.length) : [];
      }).then(onFulfilled, onRejected)
    };
  };
  sql.begin = async (callback) => { transactions++; return callback(sql); };
  const redirect = (path) => { const error = new Error("NEXT_REDIRECT"); error.path = path; throw error; };
  const mocks = {
    "server-only": {},
    "@/lib/admin-auth": { getCurrentStaff: async () => options.staff === undefined ? owner : options.staff },
    "@/lib/postgres/server": { getPostgresSql: () => { connections++; return sql; } },
    "@/lib/observability": {
      logOperationalEvent: (...args) => logs.push(args), logOperationalError: (...args) => logs.push(args)
    },
    "next/navigation": { redirect },
    "next/cache": { revalidatePath: () => {} },
    "next/link": { __esModule: true, default: ({ href, children, ...props }) => {
      delete props.prefetch;
      return require("react").createElement("a", { ...props, href }, children);
    } },
    ...options.mocks
  };
  const load = (file) => {
    file = resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} };
    cache.set(file, loadedModule);
    const source = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
    }).outputText;
    const importModule = (specifier) => {
      if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
      if (specifier.startsWith("@/lib/notifications/")) return load(`src/${specifier.slice(2)}.ts`);
      if (specifier.startsWith(".")) return load(`${resolve(dirname(file), specifier)}.ts`);
      if (["zod", "react/jsx-runtime", "lucide-react"].includes(specifier)) return require(specifier);
      throw new Error(`Unexpected import: ${specifier}`);
    };
    const setTimer = (callback) => { timers.push(callback); return { unref() {} }; };
    runInNewContext(source, {
      exports: loadedModule.exports, module: loadedModule, require: importModule, process: { env },
      fetch: options.fetch ?? (() => { throw new Error("Network forbidden in notification tests"); }),
      URL, AbortSignal, Response, Date,
      setInterval: setTimer, setTimeout: setTimer
    }, { filename: file });
    return loadedModule.exports;
  };
  return { load, calls, logs, timers, env, get connections() { return connections; }, get transactions() { return transactions; } };
}
