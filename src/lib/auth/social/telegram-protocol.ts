export function normalizeTelegramPhone(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (/^7\d{10}$/.test(digits)) return `+${digits}`;
  if (/^8\d{10}$/.test(digits)) return `+7${digits.slice(1)}`;
  if (/^\d{10}$/.test(digits)) return `+7${digits}`;
  return null;
}

export function isTelegramPhoneVerified(
  phone: string | null,
  explicitVerification: boolean | undefined
) {
  // Telegram's discovery metadata exposes phone_number but not
  // phone_number_verified. A signed phone-scope number is verified by Telegram.
  return Boolean(phone && explicitVerification !== false);
}
