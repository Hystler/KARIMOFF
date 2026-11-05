import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
const authScope = new AsyncLocalStorage<boolean>();
export function isLiveReadonlyStaging() { return process.env.STAGING_LIVE_READONLY === "true"; }
export function assertStagingBusinessWriteAllowed() {
  if (isLiveReadonlyStaging()) throw new Error("На staging доступен только просмотр. Изменения выполняются в рабочем кабинете.");
}
export function withStagingAuthWrites<T>(action: () => Promise<T>): Promise<T> {
  return authScope.run(true, action);
}
export function stagingAuthWriteAllowed(name: string, operation: string) {
  if (!isLiveReadonlyStaging() || !authScope.getStore()) return false;
  return (name === "app_sessions" && ["insert", "update"].includes(operation))
    || (name === "audit_logs" && operation === "insert")
    || (["auth_rate_limit_check", "auth_rate_limit_failure", "auth_rate_limit_clear"].includes(name) && operation === "rpc");
}
