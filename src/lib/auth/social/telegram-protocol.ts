export function normalizeTelegramPhone(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (/^7\d{10}$/.test(digits)) return `+${digits}`;
  if (/^8\d{10}$/.test(digits)) return `+7${digits.slice(1)}`;
  if (/^\d{10}$/.test(digits)) return `+7${digits}`;
  return null;
}
