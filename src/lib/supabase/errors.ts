export function formatMissingTableError(message: string | null | undefined, table: string, sqlFile: string) {
  if (!message) {
    return null;
  }

  const normalized = message.toLowerCase();

  if (normalized.includes("could not find the table") || normalized.includes("schema cache")) {
    return `Таблица ${table} не создана. Выполните SQL ${sqlFile}.`;
  }

  return message;
}
