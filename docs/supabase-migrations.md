# Supabase migrations

KARIMOFF uses Supabase SQL migrations for database schema changes.

## Preferred setup

Use Supabase CLI with a linked project:

```bash
supabase login
supabase link --project-ref isjdtrfrmwntsmddtzxr --password "<DATABASE_PASSWORD>"
npm run db:push:all
```

After the project is linked once, future schema changes can be applied with:

```bash
npm run db:push
```

If old SQL files were not recorded in Supabase migration history yet, use:

```bash
npm run db:push:all
```

## Direct DB URL fallback

If CLI linking is inconvenient, add this only to local `.env.local`:

```bash
SUPABASE_DB_URL=postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-...pooler.supabase.com:5432/postgres
```

Then run:

```bash
npm run db:push:url
```

The script reads `.env.local` automatically.

Never commit the real `SUPABASE_DB_URL`.

For migration commands the helper automatically changes a Supabase Transaction
pooler URL on port `6543` to Session pooler port `5432`. This avoids prepared
statement conflicts without printing or rewriting the secret.

## Current baseline

`supabase/migrations/202607070001_karimoff_baseline_schema.sql` is a baseline migration generated from the existing schema files in `supabase/*.sql`. It is intentionally idempotent and does not include seed data.

Seed files remain manual on purpose:

- `supabase/seed-products.sql`
- `supabase/seed-products-from-juikaifui.sql`
- `supabase/seed-vacancies.sql`
- `supabase/seed-avatar-assets.sql`

## Required access

To let Codex apply future database changes automatically, provide one of these locally:

1. Supabase CLI auth + database password.
2. `SUPABASE_DB_URL` in `.env.local`.
3. A Supabase MCP server connected to this project.

The connected Supabase MCP account currently has no permission to the KARIMOFF
production project. Until that access is granted, CLI with the local
`SUPABASE_DB_URL` is the verified migration and audit route.
