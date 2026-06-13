import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const ADMIN_COOKIE_NAME = "karimoff_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

type AdminSessionPayload = {
  phone: string;
  exp: number;
};

function isConfigured() {
  return Boolean(process.env.ADMIN_PHONE && process.env.ADMIN_PASSWORD);
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getSecret() {
  return `${process.env.ADMIN_PHONE ?? ""}:${process.env.ADMIN_PASSWORD ?? ""}`;
}

function sign(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAdminConfigured() {
  return isConfigured();
}

export function verifyAdminCredentials(phone: string, password: string) {
  if (!isConfigured()) {
    return false;
  }

  return safeCompare(phone.trim(), process.env.ADMIN_PHONE ?? "") && safeCompare(password, process.env.ADMIN_PASSWORD ?? "");
}

export async function setAdminSession(phone: string) {
  const payload = encode(
    JSON.stringify({
      phone,
      exp: Date.now() + SESSION_TTL_MS
    } satisfies AdminSessionPayload)
  );
  const value = `${payload}.${sign(payload)}`;
  const cookieStore = await cookies();

  cookieStore.set(ADMIN_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000
  });
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE_NAME);
}

export async function isAdminAuthenticated() {
  if (!isConfigured()) {
    return false;
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(ADMIN_COOKIE_NAME)?.value;

  if (!session) {
    return false;
  }

  const [payload, signature] = session.split(".");

  if (!payload || !signature || !safeCompare(sign(payload), signature)) {
    return false;
  }

  try {
    const parsed = JSON.parse(decode(payload)) as AdminSessionPayload;

    return parsed.phone === process.env.ADMIN_PHONE && parsed.exp > Date.now();
  } catch {
    return false;
  }
}
