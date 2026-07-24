import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { normalizeRussianPhone } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ADMIN_COOKIE_NAME = "karimoff_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 4;

function isConfigured() {
  return Boolean(process.env.ADMIN_PHONE && process.env.ADMIN_PASSWORD);
}

function getSecret() {
  const secret = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret) {
    throw new Error("SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY must be configured.");
  }

  return secret;
}

function hmac(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = "";

  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) return Buffer.alloc(0);
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

function totpForCounter(secret: string, counter: number) {
  const key = decodeBase32(secret);
  if (!key.length) return "";
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

function verifyTotp(code: string) {
  const secret = process.env.ADMIN_TOTP_SECRET;

  if (!secret) {
    return true;
  }

  const counter = Math.floor(Date.now() / 30_000);
  return [-1, 0, 1].some((offset) => safeCompare(totpForCounter(secret, counter + offset), code.trim()));
}

export function isAdminConfigured() {
  return isConfigured();
}

export function isAdminTotpConfigured() {
  return Boolean(process.env.ADMIN_TOTP_SECRET);
}

export function getAdminActorHash() {
  return hmac(normalizeRussianPhone(process.env.ADMIN_PHONE ?? ""));
}

export function verifyAdminCredentials(phone: string, password: string, totp = "") {
  if (!isConfigured()) {
    return false;
  }

  return (
    safeCompare(normalizeRussianPhone(phone), normalizeRussianPhone(process.env.ADMIN_PHONE ?? "")) &&
    safeCompare(password, process.env.ADMIN_PASSWORD ?? "") &&
    verifyTotp(totp)
  );
}

export async function setAdminSession(phone: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const headerStore = await headers();
  const { error } = await supabase.from("app_sessions").insert({
    expires_at: expiresAt.toISOString(),
    subject_ref_hash: hmac(normalizeRussianPhone(phone)),
    subject_type: "admin",
    token_hash: hmac(token),
    user_agent_short: (headerStore.get("user-agent") ?? "").slice(0, 255) || null
  });

  if (error) {
    throw new Error("Admin session could not be created.");
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 0
  });
  cookieStore.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  const supabase = createSupabaseServerClient();

  if (token && supabase) {
    await supabase
      .from("app_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hmac(token))
      .eq("subject_type", "admin");
  }

  cookieStore.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
  cookieStore.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 0
  });
}

export async function isAdminAuthenticated() {
  if (!isConfigured()) {
    return false;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  const supabase = createSupabaseServerClient();

  if (!token || !supabase) {
    return false;
  }

  const { data, error } = await supabase
    .from("app_sessions")
    .select("id")
    .eq("token_hash", hmac(token))
    .eq("subject_type", "admin")
    .eq("subject_ref_hash", getAdminActorHash())
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  return !error && Boolean(data);
}
