import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getPostgresSql } from "@/lib/postgres/server";

const TOKEN_PREFIX = "KARIMOFF:L1";
const CARD_ID_PATTERN = /^[0-9a-f]{32}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type LoyaltyCard = {
  id: string;
  customerId: string;
  publicCode: string;
  tokenVersion: number;
  status: "active" | "revoked";
  issuedAt: string;
  rotatedAt: string | null;
  lastUsedAt: string | null;
};

type LoyaltyCardRow = {
  id: string;
  customer_id: string;
  public_code: string;
  token_version: number;
  status: string;
  issued_at: Date | string;
  rotated_at: Date | string | null;
  last_used_at: Date | string | null;
};

function iso(value: Date | string | null) {
  return value ? new Date(value).toISOString() : null;
}

function normalizeCard(row: LoyaltyCardRow): LoyaltyCard {
  return {
    id: row.id,
    customerId: row.customer_id,
    publicCode: row.public_code,
    tokenVersion: Number(row.token_version),
    status: row.status === "revoked" ? "revoked" : "active",
    issuedAt: iso(row.issued_at) ?? new Date(0).toISOString(),
    rotatedAt: iso(row.rotated_at),
    lastUsedAt: iso(row.last_used_at)
  };
}

function signingKey() {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) throw new Error("SESSION_SECRET must be configured.");
  return createHmac("sha256", sessionSecret).update("karimoff:loyalty-card:l1").digest();
}

function cardMessage(cardId: string, tokenVersion: number) {
  return `L1:${cardId.toLowerCase()}:${tokenVersion}`;
}

function signature(cardId: string, tokenVersion: number) {
  return createHmac("sha256", signingKey())
    .update(cardMessage(cardId, tokenVersion))
    .digest("base64url");
}

export function createLoyaltyCardToken(card: Pick<LoyaltyCard, "id" | "tokenVersion">) {
  const compactId = card.id.replaceAll("-", "").toLowerCase();
  return `${TOKEN_PREFIX}:${compactId}:${card.tokenVersion}:${signature(card.id, card.tokenVersion)}`;
}

export function parseLoyaltyCardToken(token: string) {
  const parts = token.trim().split(":");
  if (parts.length !== 5 || parts[0] !== "KARIMOFF" || parts[1] !== "L1") return null;
  const compactId = parts[2]?.toLowerCase() ?? "";
  const version = Number(parts[3]);
  const receivedSignature = parts[4] ?? "";
  if (!CARD_ID_PATTERN.test(compactId) || !Number.isSafeInteger(version) || version < 1) return null;
  if (!SIGNATURE_PATTERN.test(receivedSignature)) return null;

  const id = `${compactId.slice(0, 8)}-${compactId.slice(8, 12)}-${compactId.slice(12, 16)}-${compactId.slice(16, 20)}-${compactId.slice(20)}`;
  const expected = Buffer.from(signature(id, version), "base64url");
  const received = Buffer.from(receivedSignature, "base64url");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  return { id, tokenVersion: version };
}

export async function ensureLoyaltyCard(customerId: string) {
  const sql = getPostgresSql();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const publicCode = randomBytes(6).toString("hex").toUpperCase();
    try {
      const rows = await sql<LoyaltyCardRow[]>`
        insert into public.loyalty_cards (customer_id, public_code)
        values (${customerId}::uuid, ${publicCode})
        on conflict (customer_id) do nothing
        returning id, customer_id, public_code, token_version, status,
          issued_at, rotated_at, last_used_at
      `;
      if (rows[0]) return normalizeCard(rows[0]);
      const existing = await getLoyaltyCardForCustomer(customerId);
      if (existing) return existing;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "23505" || attempt === 2) throw error;
    }
  }
  throw new Error("Loyalty card could not be issued.");
}

export async function getLoyaltyCardForCustomer(customerId: string) {
  const sql = getPostgresSql();
  const rows = await sql<LoyaltyCardRow[]>`
    select id, customer_id, public_code, token_version, status,
      issued_at, rotated_at, last_used_at
    from public.loyalty_cards
    where customer_id = ${customerId}::uuid
    limit 1
  `;
  return rows[0] ? normalizeCard(rows[0]) : null;
}

export async function rotateLoyaltyCard(customerId: string) {
  const sql = getPostgresSql();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const publicCode = randomBytes(6).toString("hex").toUpperCase();
    try {
      const rows = await sql<LoyaltyCardRow[]>`
        update public.loyalty_cards
        set token_version = token_version + 1,
            public_code = ${publicCode},
            status = 'active',
            rotated_at = now(),
            updated_at = now()
        where customer_id = ${customerId}::uuid
        returning id, customer_id, public_code, token_version, status,
          issued_at, rotated_at, last_used_at
      `;
      if (rows[0]) return normalizeCard(rows[0]);
      break;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "23505" || attempt === 2) throw error;
    }
  }
  return ensureLoyaltyCard(customerId);
}

export async function resolveLoyaltyCardToken(token: string, markUsed = false) {
  const parsed = parseLoyaltyCardToken(token);
  if (!parsed) return null;
  const sql = getPostgresSql();
  const rows = await sql<(LoyaltyCardRow & {
    customer_name: string;
    customer_phone: string;
    points_balance: string | number;
  })[]>`
    select card.id, card.customer_id, card.public_code, card.token_version,
      card.status, card.issued_at, card.rotated_at, card.last_used_at,
      customer.name as customer_name,
      customer.phone as customer_phone,
      coalesce(account.points_balance, 0) as points_balance
    from public.loyalty_cards card
    join public.customers customer on customer.id = card.customer_id
    left join public.loyalty_accounts account on account.customer_id = card.customer_id
    where card.id = ${parsed.id}::uuid
      and card.token_version = ${parsed.tokenVersion}
      and card.status = 'active'
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (markUsed) {
    await sql`
      update public.loyalty_cards
      set last_used_at = now(), updated_at = now()
      where id = ${row.id}::uuid and token_version = ${parsed.tokenVersion}
    `;
  }
  return {
    card: normalizeCard(row),
    customer: {
      id: row.customer_id,
      name: row.customer_name,
      phone: row.customer_phone,
      pointsBalance: Number(row.points_balance ?? 0)
    }
  };
}

export async function resolveLoyaltyCardPublicCode(publicCode: string, markUsed = false) {
  const normalized = publicCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{12}$/.test(normalized)) return null;
  const sql = getPostgresSql();
  const rows = await sql<(LoyaltyCardRow & {
    customer_name: string;
    customer_phone: string;
    points_balance: string | number;
  })[]>`
    select card.id, card.customer_id, card.public_code, card.token_version,
      card.status, card.issued_at, card.rotated_at, card.last_used_at,
      customer.name as customer_name,
      customer.phone as customer_phone,
      coalesce(account.points_balance, 0) as points_balance
    from public.loyalty_cards card
    join public.customers customer on customer.id = card.customer_id
    left join public.loyalty_accounts account on account.customer_id = card.customer_id
    where card.public_code = ${normalized}
      and card.status = 'active'
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (markUsed) {
    await sql`
      update public.loyalty_cards
      set last_used_at = now(), updated_at = now()
      where id = ${row.id}::uuid
    `;
  }
  return {
    card: normalizeCard(row),
    customer: {
      id: row.customer_id,
      name: row.customer_name,
      phone: row.customer_phone,
      pointsBalance: Number(row.points_balance ?? 0)
    }
  };
}
