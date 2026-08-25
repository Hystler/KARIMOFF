# KARIMOFF production launch blockers

The current Vercel + Supabase deployment is a hardened MVP environment. It is
not approved for Russian advertising traffic, production personal-data
collection, or real online payments until the following items are complete.

## P0 before traffic

- Move the production personal-data database, file storage, logs, and backups
  to infrastructure located in the Russian Federation.
- Confirm the final production domain and update public legal documents,
  metadata, cookie scope, CSP, and CORS/origin allowlists.
- Complete the Roskomnadzor notification and personal-data processing map with
  the actual Russian infrastructure and contractors.
- Rotate the PostgreSQL password that was previously disclosed. Update
  `SUPABASE_DB_URL` locally and in the protected deployment environment. Never
  commit or print it.
- Generate independent high-entropy `SESSION_SECRET` and
  `AUTH_RATE_LIMIT_SECRET` values in the deployment environment.
- Complete owner TOTP enrollment, one-time recovery codes, secure reset and
  recovery testing. Keep `ADMIN_TOTP_SECRET` unset until that flow is complete.
- Verify the Supabase Storage bucket policies and retain service-role upload
  access only. Public read is acceptable only for intentionally public media.
- Define backup frequency, restore testing, retention, incident response, and
  employee access revocation.

## Customer communications

- Select and contract a Russian-compatible SMS provider.
- Implement and review its server-side adapter. Until then, phone-code login
  fails closed in production; password login remains available.
- Select any analytics or marketing provider only after a privacy/legal review.
  Optional cookie categories currently store preference but load no scripts.

## Payments and fiscalization

- Select the internet acquiring provider (for example, YooKassa or a bank) and
  obtain the shop identifier, API credentials, webhook requirements, refund
  rules, and test environment.
- Confirm KKT/OFD integration, fiscal receipt data, taxation/VAT treatment, and
  the relationship with Evotor. Evotor is not assumed to be the acquiring
  provider.
- Confirm cancellation and refund rules after payment and after cooking starts.
- Complete provider adapter, signed webhook verification, server-to-server
  payment verification, idempotency, refunds, and fiscal-status updates.
- Keep `PAYMENTS_ENABLED=false` until the Russian production environment,
  provider acceptance tests, and legal text are complete.

## Product and loyalty data

- Fill weight, composition, and KBJU from approved product data.
- Publish allergens only after the factual list has been confirmed for every
  SKU. The admin UI deliberately warns on missing allergen data.
- Approve the maximum percentage of an order that can be paid with bonuses.
  `loyalty_redemption_limit_percent` must remain empty until approval.

## Tooling access

- Supabase CLI migrations work through `SUPABASE_DB_URL`.
- The connected Supabase MCP account does not currently expose the KARIMOFF
  project. Grant that connector access before relying on MCP verification;
  until then, use `npm run db:migrations`, `npm run db:test`, and
  `npm run db:audit`.
