import "server-only";

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");

  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined) {
  if (!storedHash) {
    return false;
  }

  const [method, salt, hash] = storedHash.split(":");

  if (method !== "scrypt" || !salt || !hash) {
    return false;
  }

  const calculated = Buffer.from(scryptSync(password, salt, KEY_LENGTH).toString("hex"));
  const expected = Buffer.from(hash);

  if (calculated.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(calculated, expected);
}
