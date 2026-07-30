import "server-only";

import type { Product } from "@/lib/product-types";
import { createPostgresServerClient } from "@/lib/postgres/server";

export type LeadRow = {
  id: string;
  created_at: string;
  name: string;
  phone: string;
  interest: "order" | "b2b" | "career" | "franchise" | "other";
  comment: string | null;
  status: "new" | "in_progress" | "closed";
  source: string | null;
};

export type ProductRow = Product;

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function createDatabaseServerClient() {
  return createPostgresServerClient();
}
