-- PostgreSQL cannot infer a partial unique index for
-- ON CONFLICT (idempotency_key) without repeating its predicate.
-- A regular UNIQUE index still permits multiple NULL values and matches
-- the idempotent earn/reversal statements used by the order status RPC.
drop index if exists public.loyalty_transactions_idempotency_key_idx;

create unique index loyalty_transactions_idempotency_key_idx
  on public.loyalty_transactions (idempotency_key);
