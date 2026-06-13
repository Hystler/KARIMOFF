import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Product } from "@/lib/product-types";

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
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

export function createSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
