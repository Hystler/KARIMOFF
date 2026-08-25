import "server-only";

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { EvotorConfigurationError } from "./errors";

const CURRENT_VERSION = "v1";
const V1_IV_BYTES = 12;
const V1_AUTH_TAG_BYTES = 16;

export type EvotorTokenEnvelope = {
  version: "v1";
  iv: Buffer;
  encrypted: Buffer;
  authTag: Buffer;
};

export type DecryptedEvotorToken = {
  token: string;
  version: "v1";
  keySource: "primary" | "previous";
  needsReencrypt: boolean;
};

function configurationError(message: string, code: string) {
  return new EvotorConfigurationError(message, code);
}

function decodeEncryptionKey(configured: string, source: string) {
  const normalized = configured.trim();
  const key = /^[a-f0-9]{64}$/i.test(normalized)
    ? Buffer.from(normalized, "hex")
    : Buffer.from(normalized, "base64");

  if (key.length !== 32) {
    throw configurationError(
      `${source} must contain exactly 32 bytes.`,
      "TOKEN_ENCRYPTION_KEY_INVALID"
    );
  }
  return key;
}

function encryptionKey() {
  const configured = process.env.EVOTOR_TOKEN_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw configurationError(
      "EVOTOR_TOKEN_ENCRYPTION_KEY is not configured.",
      "TOKEN_ENCRYPTION_KEY_MISSING"
    );
  }
  return decodeEncryptionKey(configured, "EVOTOR_TOKEN_ENCRYPTION_KEY");
}

function previousEncryptionKeys() {
  const configured = process.env.EVOTOR_TOKEN_PREVIOUS_ENCRYPTION_KEYS?.trim();
  if (!configured) return [];
  return configured
    .split(",")
    .map((value) => decodeEncryptionKey(value, "EVOTOR_TOKEN_PREVIOUS_ENCRYPTION_KEYS"));
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw configurationError("Unsupported Evotor token payload.", "TOKEN_PAYLOAD_INVALID");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw configurationError("Unsupported Evotor token payload.", "TOKEN_PAYLOAD_INVALID");
  }
  return decoded;
}

export function inspectEvotorTokenEnvelope(payload: string): EvotorTokenEnvelope {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== CURRENT_VERSION) {
    throw configurationError("Unsupported Evotor token payload.", "TOKEN_PAYLOAD_INVALID");
  }
  const iv = decodeBase64Url(parts[1]);
  const encrypted = decodeBase64Url(parts[2]);
  const authTag = decodeBase64Url(parts[3]);
  if (iv.length !== V1_IV_BYTES || !encrypted.length || authTag.length !== V1_AUTH_TAG_BYTES) {
    throw configurationError("Unsupported Evotor token payload.", "TOKEN_PAYLOAD_INVALID");
  }
  return { version: "v1", iv, encrypted, authTag };
}

function decryptV1(envelope: EvotorTokenEnvelope, key: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", key, envelope.iv);
  decipher.setAuthTag(envelope.authTag);
  return Buffer.concat([
    decipher.update(envelope.encrypted),
    decipher.final()
  ]).toString("utf8");
}

export function encryptEvotorToken(token: string) {
  const iv = randomBytes(V1_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CURRENT_VERSION,
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    tag.toString("base64url")
  ].join(".");
}

export function decryptEvotorTokenEnvelope(payload: string): DecryptedEvotorToken {
  const envelope = inspectEvotorTokenEnvelope(payload);
  const primary = encryptionKey();
  try {
    return {
      token: decryptV1(envelope, primary),
      version: envelope.version,
      keySource: "primary",
      needsReencrypt: false
    };
  } catch {
    // Fall through to explicitly configured rotation keys.
  }
  for (const key of previousEncryptionKeys()) {
    if (key.equals(primary)) continue;
    try {
      return {
        token: decryptV1(envelope, key),
        version: envelope.version,
        keySource: "previous",
        needsReencrypt: true
      };
    } catch {
      // Try the next explicitly configured key without exposing token material.
    }
  }
  throw configurationError(
    "Evotor token could not be decrypted with the configured key set.",
    "TOKEN_DECRYPTION_FAILED"
  );
}

export function decryptEvotorToken(payload: string) {
  return decryptEvotorTokenEnvelope(payload).token;
}

export function tryDecryptEvotorToken(payload: string) {
  try {
    return { ok: true as const, value: decryptEvotorTokenEnvelope(payload) };
  } catch (error) {
    if (error instanceof EvotorConfigurationError) {
      return { ok: false as const, errorCode: error.code };
    }
    return { ok: false as const, errorCode: "TOKEN_DECRYPTION_FAILED" };
  }
}

export function fingerprintEvotorToken(token: string) {
  return createHmac("sha256", encryptionKey()).update(token).digest("hex");
}
