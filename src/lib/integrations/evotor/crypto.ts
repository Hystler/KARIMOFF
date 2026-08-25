import "server-only";

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { EvotorConfigurationError } from "./errors";

const VERSION = "v1";

function encryptionKey() {
  const configured = process.env.EVOTOR_TOKEN_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new EvotorConfigurationError(
      "EVOTOR_TOKEN_ENCRYPTION_KEY is not configured.",
      "TOKEN_ENCRYPTION_KEY_MISSING"
    );
  }

  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");

  if (key.length !== 32) {
    throw new EvotorConfigurationError(
      "EVOTOR_TOKEN_ENCRYPTION_KEY must contain exactly 32 bytes.",
      "TOKEN_ENCRYPTION_KEY_INVALID"
    );
  }
  return key;
}

export function encryptEvotorToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), encrypted.toString("base64url"), tag.toString("base64url")].join(".");
}

export function decryptEvotorToken(payload: string) {
  const [version, ivValue, encryptedValue, tagValue] = payload.split(".");
  if (version !== VERSION || !ivValue || !encryptedValue || !tagValue) {
    throw new EvotorConfigurationError(
      "Unsupported Evotor token payload.",
      "TOKEN_PAYLOAD_INVALID"
    );
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof EvotorConfigurationError) throw error;
    throw new EvotorConfigurationError(
      "Evotor token could not be decrypted.",
      "TOKEN_DECRYPTION_FAILED"
    );
  }
}

export function fingerprintEvotorToken(token: string) {
  return createHmac("sha256", encryptionKey()).update(token).digest("hex");
}
