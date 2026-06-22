const RUSSIAN_PREFIX = "+7";

function digitsOnly(input: string) {
  return input.replace(/\D/g, "");
}

function basicPhone(input: string) {
  return input.trim().replace(/[^\d+]/g, "");
}

export function normalizeRussianPhone(input: string) {
  const digits = digitsOnly(input);

  if (!digits) {
    return RUSSIAN_PREFIX;
  }

  if (digits.length === 10) {
    return `+7${digits}`;
  }

  if (digits.startsWith("8") && digits.length >= 11) {
    return `+7${digits.slice(1, 11)}`;
  }

  if (digits.startsWith("7") && digits.length >= 11) {
    return `+${digits.slice(0, 11)}`;
  }

  if (digits.startsWith("9")) {
    return `+7${digits.slice(0, 10)}`;
  }

  return `+${digits}`;
}

export function formatRussianPhoneInput(input: string) {
  const normalized = normalizeRussianPhone(input);
  const digits = digitsOnly(normalized).slice(1, 11);

  if (!digits) {
    return RUSSIAN_PREFIX;
  }

  const parts = [
    digits.slice(0, 3),
    digits.slice(3, 6),
    digits.slice(6, 8),
    digits.slice(8, 10)
  ].filter(Boolean);

  if (parts.length === 1) {
    return `+7 (${parts[0]}`;
  }

  if (parts.length === 2) {
    return `+7 (${parts[0]}) ${parts[1]}`;
  }

  if (parts.length === 3) {
    return `+7 (${parts[0]}) ${parts[1]}-${parts[2]}`;
  }

  return `+7 (${parts[0]}) ${parts[1]}-${parts[2]}-${parts[3]}`;
}

export function formatPhoneInput(input: string) {
  return formatRussianPhoneInput(input);
}

export function getPhoneLookupCandidates(input: string) {
  const normalized = normalizeRussianPhone(input);
  const basic = basicPhone(input);
  const candidates = [normalized, basic];

  return Array.from(new Set(candidates.filter(Boolean)));
}
