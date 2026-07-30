import "server-only";

import { createHmac, randomBytes, randomInt } from "node:crypto";
import { cookies, headers } from "next/headers";
import { normalizeRussianPhone } from "@/lib/phone";
import { createDatabaseServerClient } from "@/lib/database/server";

export type CustomerSession = {
  customerId: string;
  exp: number;
};

export type CustomerProfile = {
  id: string;
  name: string;
  phone: string;
  birthday: string | null;
};

const CUSTOMER_COOKIE_NAME = "karimoff_customer_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const CODE_TTL_MS = 1000 * 60 * 10;

function getSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("SESSION_SECRET must be configured.");
  }

  return secret;
}

function hashToken(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

export function normalizePhone(phone: string) {
  return normalizeRussianPhone(phone);
}

export function createVerificationCode() {
  return String(randomInt(100000, 1000000));
}

export function hashVerificationCode(phone: string, code: string) {
  return createHmac("sha256", getSecret()).update(`${normalizePhone(phone)}:${code}`).digest("hex");
}

export function getVerificationExpiresAt() {
  return new Date(Date.now() + CODE_TTL_MS).toISOString();
}

export async function setCustomerSession(customerId: string) {
  const database = createDatabaseServerClient();

  if (!database) {
    throw new Error("Database is not configured.");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const headerStore = await headers();
  const { error } = await database.from("app_sessions").insert({
    expires_at: expiresAt.toISOString(),
    subject_id: customerId,
    subject_type: "customer",
    token_hash: hashToken(token),
    user_agent_short: (headerStore.get("user-agent") ?? "").slice(0, 255) || null
  });

  if (error) {
    throw new Error("Customer session could not be created.");
  }

  const cookieStore = await cookies();
  cookieStore.set(CUSTOMER_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

export async function clearCustomerSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOMER_COOKIE_NAME)?.value;
  const database = createDatabaseServerClient();

  if (token && database) {
    await database
      .from("app_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hashToken(token))
      .eq("subject_type", "customer");
  }

  cookieStore.delete(CUSTOMER_COOKIE_NAME);
}

export async function getCustomerSession(): Promise<CustomerSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOMER_COOKIE_NAME)?.value;
  const database = createDatabaseServerClient();

  if (!token || !database) {
    return null;
  }

  const { data, error } = await database
    .from("app_sessions")
    .select("subject_id, expires_at")
    .eq("token_hash", hashToken(token))
    .eq("subject_type", "customer")
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data?.subject_id) {
    return null;
  }

  return {
    customerId: String(data.subject_id),
    exp: new Date(String(data.expires_at)).getTime()
  };
}

export async function getCurrentCustomer(): Promise<CustomerProfile | null> {
  const session = await getCustomerSession();

  if (!session) {
    return null;
  }

  const database = createDatabaseServerClient();

  if (!database) {
    return null;
  }

  const { data, error } = await database
    .from("customers")
    .select("id, name, phone, birthday")
    .eq("id", session.customerId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: String(data.id),
    name: String(data.name),
    phone: String(data.phone),
    birthday: typeof data.birthday === "string" ? data.birthday : null
  };
}
