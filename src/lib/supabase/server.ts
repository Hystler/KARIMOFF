import "server-only";

import { createClient } from "@supabase/supabase-js";
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

export function isSupabaseConfigured() {
  if (process.env.DATABASE_PROVIDER === "postgres") {
    return Boolean(process.env.DATABASE_URL);
  }
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function createSupabaseServerClient() {
  if (process.env.DATABASE_PROVIDER === "postgres") {
    return createPostgresServerClient() as unknown as ReturnType<typeof createClient>;
  }

  return createSupabaseServiceClient();
}

export function createSupabaseServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
