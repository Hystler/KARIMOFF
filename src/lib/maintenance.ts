export const MAINTENANCE_MESSAGE =
  "Сервис временно обновляется. Попробуйте снова через несколько минут.";

export function isMaintenanceMode() {
  return process.env.MAINTENANCE_MODE === "true";
}

export function isReadOnlyRequest(method: string) {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}
