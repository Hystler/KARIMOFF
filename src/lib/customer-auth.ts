import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CustomerSession = {
  customerId: string;
  exp: number;
};

export type CustomerProfile = {
  id: string;
  name: string;
  phone: string;
};

const CUSTOMER_COOKIE_NAME = "karimoff_customer_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const CODE_TTL_MS = 1000 * 60 * 10;

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getSecret() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.ADMIN_PASSWORD ||
    process.env.SMS_API_KEY ||
    "karimoff-dev-customer-session"
  );
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

export function normalizePhone(phone: string) {
  return phone.trim().replace(/[^\d+]/g, "");
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
  const payload = encode(
    JSON.stringify({
      customerId,
      exp: Date.now() + SESSION_TTL_MS
    } satisfies CustomerSession)
  );
  const value = `${payload}.${sign(payload)}`;
  const cookieStore = await cookies();

  cookieStore.set(CUSTOMER_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000
  });
}

export async function clearCustomerSession() {
  const cookieStore = await cookies();
  cookieStore.delete(CUSTOMER_COOKIE_NAME);
}

export async function getCustomerSession() {
  const cookieStore = await cookies();
  const session = cookieStore.get(CUSTOMER_COOKIE_NAME)?.value;

  if (!session) {
    return null;
  }

  const [payload, signature] = session.split(".");

  if (!payload || !signature || !safeCompare(sign(payload), signature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(decode(payload)) as CustomerSession;

    if (!parsed.customerId || parsed.exp <= Date.now()) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function getCurrentCustomer(): Promise<CustomerProfile | null> {
  const session = await getCustomerSession();

  if (!session) {
    return null;
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone")
    .eq("id", session.customerId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: String(data.id),
    name: String(data.name),
    phone: String(data.phone)
  };
}
