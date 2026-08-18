import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { normalizeRussianPhone } from "@/lib/phone";
import { createDatabaseServerClient } from "@/lib/database/server";
import { verifyPassword } from "@/lib/password-auth";

const ADMIN_COOKIE_NAME = "karimoff_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 4;

export type StaffRole = "owner" | "admin" | "manager" | "cashier" | "cook";

export type CurrentStaff = {
  id: string | null;
  name: string;
  phone: string;
  role: StaffRole;
  legacy: boolean;
};

function isConfigured() {
  const passwordHash = process.env.ADMIN_PASSWORD_HASH ?? "";
  return Boolean(process.env.ADMIN_PHONE && /^\$2[aby]\$/.test(passwordHash));
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be configured.");
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
  if (!secret) return true;
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
  const credentialFingerprint = createHmac("sha256", getSecret())
    .update(process.env.ADMIN_PASSWORD_HASH ?? "")
    .digest("hex")
    .slice(0, 16);
  return hmac(`${normalizeRussianPhone(process.env.ADMIN_PHONE ?? "")}:${credentialFingerprint}`);
}

export async function verifyAdminCredentials(phone: string, password: string, totp = "") {
  if (!isConfigured()) return false;
  const expectedPhoneHash = hmac(normalizeRussianPhone(process.env.ADMIN_PHONE ?? ""));
  const actualPhoneHash = hmac(normalizeRussianPhone(phone));
  const [phoneMatches, passwordMatches] = [
    safeCompare(actualPhoneHash, expectedPhoneHash),
    await verifyPassword(password, process.env.ADMIN_PASSWORD_HASH)
  ];
  return phoneMatches && passwordMatches && verifyTotp(totp);
}

async function revokeCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  const database = createDatabaseServerClient();

  if (token && database) {
    await database
      .from("app_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hmac(token))
      .in("subject_type", ["admin", "staff"]);
  }
}

async function setSession(params: {
  subjectType: "admin" | "staff";
  subjectId?: string | null;
  subjectRefHash?: string | null;
}) {
  const database = createDatabaseServerClient();
  if (!database) throw new Error("Database is not configured.");

  await revokeCurrentSession();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const headerStore = await headers();
  const { error } = await database.from("app_sessions").insert({
    expires_at: expiresAt.toISOString(),
    subject_id: params.subjectId ?? null,
    subject_ref_hash: params.subjectRefHash ?? null,
    subject_type: params.subjectType,
    token_hash: hmac(token),
    user_agent_short: (headerStore.get("user-agent") ?? "").slice(0, 255) || null
  });

  if (error) throw new Error("Staff session could not be created.");

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

export async function setAdminSession() {
  return setSession({
    subjectType: "admin",
    subjectRefHash: getAdminActorHash()
  });
}

export async function setStaffSession(staffId: string) {
  return setSession({ subjectType: "staff", subjectId: staffId });
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  const database = createDatabaseServerClient();

  if (token && database) {
    await database
      .from("app_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hmac(token))
      .in("subject_type", ["admin", "staff"]);
  }

  cookieStore.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  const database = createDatabaseServerClient();
  if (!token || !database) return null;

  const { data: session, error } = await database
    .from("app_sessions")
    .select("subject_id, subject_type, subject_ref_hash")
    .eq("token_hash", hmac(token))
    .in("subject_type", ["admin", "staff"])
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !session) return null;

  if (session.subject_type === "admin") {
    if (!isConfigured() || session.subject_ref_hash !== getAdminActorHash()) return null;
    return {
      id: null,
      name: "Владелец",
      phone: normalizeRussianPhone(process.env.ADMIN_PHONE ?? ""),
      role: "admin",
      legacy: true
    };
  }

  if (!session.subject_id) return null;
  const { data: staff } = await database
    .from("staff_users")
    .select("id, name, phone, role, is_active")
    .eq("id", session.subject_id)
    .eq("is_active", true)
    .maybeSingle();

  if (!staff || !["owner", "admin", "manager", "cashier", "cook"].includes(String(staff.role))) return null;

  return {
    id: String(staff.id),
    name: String(staff.name),
    phone: String(staff.phone),
    role: staff.role as StaffRole,
    legacy: false
  };
}

export async function isAdminAuthenticated() {
  const staff = await getCurrentStaff();
  return staff?.role === "owner" || staff?.role === "admin" || staff?.role === "manager";
}

export async function isKitchenAuthenticated() {
  return Boolean(await getCurrentStaff());
}
