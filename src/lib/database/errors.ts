export function formatMissingTableError(message: string | null | undefined, table: string) {
  if (!message) {
    return null;
  }

  const normalized = message.toLowerCase();

  if (
    normalized.includes("does not exist") ||
    normalized.includes("undefined table") ||
    normalized.includes("could not find the table")
  ) {
    return `Таблица ${table} не создана. Примените актуальные миграции PostgreSQL.`;
  }

  return message;
}
