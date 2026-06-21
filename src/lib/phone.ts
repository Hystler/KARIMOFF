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

export function formatPhoneInput(input: string) {
  if (!input.trim()) {
    return RUSSIAN_PREFIX;
  }

  return normalizeRussianPhone(input);
}

export function getPhoneLookupCandidates(input: string) {
  const normalized = normalizeRussianPhone(input);
  const basic = basicPhone(input);
  const candidates = [normalized, basic];

  return Array.from(new Set(candidates.filter(Boolean)));
}
