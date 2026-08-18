import "server-only";

import { scryptSync, timingSafeEqual } from "node:crypto";
import { compare, getRounds, hash } from "bcryptjs";

const KEY_LENGTH = 64;
export const PASSWORD_BCRYPT_COST = 12;

function verifyLegacyScrypt(password: string, storedHash: string) {
  const [method, salt, digest] = storedHash.split(":");

  if (method !== "scrypt" || !salt || !digest) {
    return false;
  }

  const calculated = Buffer.from(scryptSync(password, salt, KEY_LENGTH).toString("hex"));
  const expected = Buffer.from(digest);

  return calculated.length === expected.length && timingSafeEqual(calculated, expected);
}

export async function hashPassword(password: string) {
  return hash(password, PASSWORD_BCRYPT_COST);
}

export async function verifyPassword(password: string, storedHash: string | null | undefined) {
  if (!storedHash) {
    return false;
  }

  if (/^\$2[aby]\$/.test(storedHash)) {
    try {
      return await compare(password, storedHash);
    } catch {
      return false;
    }
  }

  return verifyLegacyScrypt(password, storedHash);
}

export function passwordNeedsRehash(storedHash: string | null | undefined) {
  if (!storedHash || !/^\$2[aby]\$/.test(storedHash)) {
    return true;
  }

  try {
    return getRounds(storedHash) < PASSWORD_BCRYPT_COST;
  } catch {
    return true;
  }
}
