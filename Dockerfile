# syntax=docker/dockerfile:1

FROM node:22-alpine AS base

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS dependencies

COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres
COPY --from=builder --chown=nextjs:nodejs /app/scripts/apply-runtime-data-migrations.mjs ./scripts/apply-runtime-data-migrations.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/apply-runtime-schema-migrations.mjs ./scripts/apply-runtime-schema-migrations.mjs
COPY --from=builder --chown=nextjs:nodejs /app/data/tech-cards ./data/tech-cards
COPY --from=builder --chown=nextjs:nodejs /app/supabase/migrations/20260811223000_same_day_orders_waste_evotor_analytics.sql ./supabase/migrations/20260811223000_same_day_orders_waste_evotor_analytics.sql
COPY --from=builder --chown=nextjs:nodejs /app/supabase/migrations/20260812153000_add_production_accounting.sql ./supabase/migrations/20260812153000_add_production_accounting.sql
COPY --from=builder --chown=nextjs:nodejs /app/supabase/migrations/20260812190000_add_evotor_cloud_integration.sql ./supabase/migrations/20260812190000_add_evotor_cloud_integration.sql
COPY --from=builder --chown=nextjs:nodejs /app/supabase/migrations/20260812213000_add_unified_sales_analytics.sql ./supabase/migrations/20260812213000_add_unified_sales_analytics.sql
COPY --from=builder --chown=nextjs:nodejs /app/supabase/migrations/20260814120000_add_canonical_order_flow_kds.sql ./supabase/migrations/20260814120000_add_canonical_order_flow_kds.sql
COPY --from=builder --chown=nextjs:nodejs /app/supabase/migrations/20260815103000_refine_pos_kds_display_operations.sql ./supabase/migrations/20260815103000_refine_pos_kds_display_operations.sql
COPY --from=builder --chown=nextjs:nodejs /app/supabase/migrations/20260818170000_add_social_identities_and_auth_hardening.sql ./supabase/migrations/20260818170000_add_social_identities_and_auth_hardening.sql
COPY --from=builder --chown=nextjs:nodejs /app/supabase/migrations/20260820190000_add_max_social_auth.sql ./supabase/migrations/20260820190000_add_max_social_auth.sql
COPY --from=builder --chown=nextjs:nodejs /app/supabase/migrations/20260824120000_add_telegram_browser_consume.sql ./supabase/migrations/20260824120000_add_telegram_browser_consume.sql

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["sh", "-c", "node scripts/apply-runtime-schema-migrations.mjs && node scripts/apply-runtime-data-migrations.mjs && node server.js"]
