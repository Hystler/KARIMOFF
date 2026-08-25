import "server-only";

type OperationalFields = Record<string, string | number | boolean | null | undefined>;

export function logOperationalEvent(event: string, fields: OperationalFields = {}) {
  const payload = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  );
  console.info(JSON.stringify({
    level: "info",
    event,
    at: new Date().toISOString(),
    ...payload
  }));
}

export function logOperationalError(event: string, fields: OperationalFields = {}) {
  const payload = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  );
  console.error(JSON.stringify({
    level: "error",
    event,
    at: new Date().toISOString(),
    ...payload
  }));
}
