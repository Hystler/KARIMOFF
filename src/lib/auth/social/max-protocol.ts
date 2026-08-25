import { createHmac, timingSafeEqual } from "node:crypto";
import type { SocialIdentityClaims } from "./types";

const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const BASE64_HASH_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const BASE64URL_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const MAX_INIT_DATA_AGE_SECONDS = 60 * 60;
const MAX_CONTACT_AGE_SECONDS = 5 * 60;
const FUTURE_CLOCK_SKEW_SECONDS = 60;

export type MaxValidationErrorCode =
  | "bot_token_missing"
  | "contact_expired"
  | "contact_future"
  | "contact_hash_invalid"
  | "contact_invalid"
  | "contact_phone_invalid"
  | "init_data_duplicate"
  | "init_data_expired"
  | "init_data_future"
  | "init_data_hash_invalid"
  | "init_data_malformed"
  | "init_data_user_invalid"
  | "start_param_invalid";

export class MaxValidationError extends Error {
  readonly code: MaxValidationErrorCode;

  constructor(code: MaxValidationErrorCode) {
    super(code);
    this.name = "MaxValidationError";
    this.code = code;
  }
}

type MaxInitUser = {
  id: number | string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  language_code?: string | null;
  photo_url?: string | null;
};

export type ValidatedMaxInitData = {
  authDate: number;
  challenge: string;
  claims: SocialIdentityClaims;
};

export type MaxContactPayload = {
  authDate: string;
  hash: string;
  phone: string;
};

function equalHex(left: string, right: string) {
  if (!HASH_PATTERN.test(left) || !HASH_PATTERN.test(right)) return false;
  const leftBuffer = Buffer.from(left.toLowerCase(), "hex");
  const rightBuffer = Buffer.from(right.toLowerCase(), "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function decodeContactHash(value: string) {
  if (HASH_PATTERN.test(value)) return Buffer.from(value.toLowerCase(), "hex");
  if (BASE64_HASH_PATTERN.test(value)) return Buffer.from(value, "base64");
  if (BASE64URL_HASH_PATTERN.test(value)) return Buffer.from(`${value}=`, "base64url");
  return null;
}

function decodeValue(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    throw new MaxValidationError("init_data_malformed");
  }
}

function parseUniqueParameters(raw: string) {
  if (!raw || raw.length > 16_384) throw new MaxValidationError("init_data_malformed");
  const entries = raw.split("&").map((part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) throw new MaxValidationError("init_data_malformed");
    const key = part.slice(0, separator);
    if (!/^[a-z_]{1,64}$/.test(key)) throw new MaxValidationError("init_data_malformed");
    return [key, decodeValue(part.slice(separator + 1))] as const;
  });
  const keys = new Set<string>();
  for (const [key] of entries) {
    if (keys.has(key)) throw new MaxValidationError("init_data_duplicate");
    keys.add(key);
  }
  return entries;
}

function parseTimestamp(value: string | undefined, code: MaxValidationErrorCode) {
  if (!value || !/^\d{1,12}$/.test(value)) throw new MaxValidationError(code);
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new MaxValidationError(code);
  return timestamp;
}

function parseContactTimestamp(value: string) {
  // MAX Bridge documents authDate as a timestamp string. Accept the two
  // standard Unix encodings while preserving the raw signed value verbatim.
  if (!/^\d{10}(?:\d{3})?$/.test(value)) {
    throw new MaxValidationError("contact_invalid");
  }
  const rawTimestamp = Number(value);
  if (!Number.isSafeInteger(rawTimestamp) || rawTimestamp <= 0) {
    throw new MaxValidationError("contact_invalid");
  }
  return value.length === 13 ? Math.floor(rawTimestamp / 1000) : rawTimestamp;
}

function assertFreshTimestamp(params: {
  timestamp: number;
  nowSeconds: number;
  maxAgeSeconds: number;
  expiredCode: MaxValidationErrorCode;
  futureCode: MaxValidationErrorCode;
}) {
  if (params.timestamp > params.nowSeconds + FUTURE_CLOCK_SKEW_SECONDS) {
    throw new MaxValidationError(params.futureCode);
  }
  if (params.timestamp < params.nowSeconds - params.maxAgeSeconds) {
    throw new MaxValidationError(params.expiredCode);
  }
}

function cleanOptionalString(value: unknown, maxLength: number) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new MaxValidationError("init_data_user_invalid");
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength) throw new MaxValidationError("init_data_user_invalid");
  return cleaned;
}

function parseUser(value: string | undefined) {
  if (!value || value.length > 8192) throw new MaxValidationError("init_data_user_invalid");
  let candidate: MaxInitUser;
  try {
    candidate = JSON.parse(value) as MaxInitUser;
  } catch {
    throw new MaxValidationError("init_data_user_invalid");
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new MaxValidationError("init_data_user_invalid");
  }
  const providerUserId = typeof candidate.id === "number"
    ? Number.isSafeInteger(candidate.id) && candidate.id > 0 ? String(candidate.id) : null
    : /^\d{1,32}$/.test(candidate.id) ? candidate.id : null;
  if (!providerUserId) throw new MaxValidationError("init_data_user_invalid");

  const givenName = cleanOptionalString(candidate.first_name, 80);
  const familyName = cleanOptionalString(candidate.last_name, 80);
  const username = cleanOptionalString(candidate.username, 128);
  const languageCode = cleanOptionalString(candidate.language_code, 16);
  const avatarUrl = cleanOptionalString(candidate.photo_url, 2048);
  if (avatarUrl) {
    try {
      if (new URL(avatarUrl).protocol !== "https:") throw new Error("invalid protocol");
    } catch {
      throw new MaxValidationError("init_data_user_invalid");
    }
  }

  return {
    providerUserId,
    username,
    displayName: [givenName, familyName].filter(Boolean).join(" ") || username,
    avatarUrl,
    metadata: {
      givenName,
      familyName,
      languageCode,
      source: "max_mini_app"
    }
  };
}

export function validateMaxWebAppData(params: {
  initData: string;
  botToken: string;
  nowSeconds?: number;
}): ValidatedMaxInitData {
  if (!params.botToken) throw new MaxValidationError("bot_token_missing");
  const entries = parseUniqueParameters(params.initData);
  const values = new Map(entries);
  const receivedHash = values.get("hash");
  if (!receivedHash || !HASH_PATTERN.test(receivedHash)) {
    throw new MaxValidationError("init_data_hash_invalid");
  }

  const launchParams = entries
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(params.botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(launchParams).digest("hex");
  if (!equalHex(receivedHash, expectedHash)) {
    throw new MaxValidationError("init_data_hash_invalid");
  }

  const authDate = parseTimestamp(values.get("auth_date"), "init_data_malformed");
  assertFreshTimestamp({
    timestamp: authDate,
    nowSeconds: params.nowSeconds ?? Math.floor(Date.now() / 1000),
    maxAgeSeconds: MAX_INIT_DATA_AGE_SECONDS,
    expiredCode: "init_data_expired",
    futureCode: "init_data_future"
  });
  const challenge = values.get("start_param") ?? "";
  if (!CHALLENGE_PATTERN.test(challenge)) throw new MaxValidationError("start_param_invalid");
  const user = parseUser(values.get("user"));

  return {
    authDate,
    challenge,
    claims: {
      provider: "max",
      providerUserId: user.providerUserId,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      email: null,
      phone: null,
      phoneVerified: false,
      metadata: user.metadata
    }
  };
}

function normalizeMaxPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10) return `+7${digits}`;
  return null;
}

export function validateMaxContact(params: {
  contact: MaxContactPayload;
  botToken: string;
  userId: string;
  nowSeconds?: number;
}) {
  if (!params.botToken) throw new MaxValidationError("bot_token_missing");
  const { contact } = params;
  if (!contact || typeof contact !== "object") {
    throw new MaxValidationError("contact_invalid");
  }
  const receivedHash = decodeContactHash(contact.hash);
  if (!receivedHash || receivedHash.length !== 32) {
    throw new MaxValidationError("contact_hash_invalid");
  }
  const authDate = parseContactTimestamp(contact.authDate);
  assertFreshTimestamp({
    timestamp: authDate,
    nowSeconds: params.nowSeconds ?? Math.floor(Date.now() / 1000),
    maxAgeSeconds: MAX_CONTACT_AGE_SECONDS,
    expiredCode: "contact_expired",
    futureCode: "contact_future"
  });
  if (!/^\d{1,32}$/.test(params.userId)) throw new MaxValidationError("contact_invalid");
  const phoneWithoutPlus = contact.phone.replace(/\D/g, "");
  const normalizedPhone = normalizeMaxPhone(contact.phone);
  if (!normalizedPhone || !phoneWithoutPlus) throw new MaxValidationError("contact_phone_invalid");

  const data = [
    `authDate=${contact.authDate}`,
    `phone=${phoneWithoutPlus}`,
    `userId=${params.userId}`
  ].join("\n");
  const expectedHash = createHmac("sha256", params.botToken).update(data).digest();
  if (receivedHash.length !== expectedHash.length || !timingSafeEqual(receivedHash, expectedHash)) {
    throw new MaxValidationError("contact_hash_invalid");
  }
  return normalizedPhone;
}

export function describeMaxContact(contact: MaxContactPayload) {
  return {
    authDateFormat: /^\d{10}$/.test(contact.authDate)
      ? "seconds" as const
      : /^\d{13}$/.test(contact.authDate)
        ? "milliseconds" as const
        : "invalid" as const,
    hashFormat: HASH_PATTERN.test(contact.hash)
      ? "hex64" as const
      : BASE64_HASH_PATTERN.test(contact.hash) || BASE64URL_HASH_PATTERN.test(contact.hash)
        ? "base64" as const
        : "invalid" as const,
    phonePresent: Boolean(contact.phone)
  };
}
