# KARIMOFF: аудит миграции Supabase -> Timeweb

Дата аудита: 2026-07-28.

## Границы

- Источник: production Supabase, PostgreSQL 17.6.
- Назначение: Timeweb Cloud PostgreSQL 17.10, кластер `Fair Plover`.
- Production-приложение во время аудита не переключалось.
- Supabase Auth и Realtime приложением не используются.
- Supabase не удалялся и не изменялся.
- Supabase MCP был авторизован в другом аккаунте, поэтому фактический каталог KARIMOFF снят read-only SQL через существующий `SUPABASE_DB_URL`.

## Схемы и расширения источника

Supabase содержит служебные схемы `auth`, `extensions`, `graphql`, `graphql_public`,
`realtime`, `storage`, `supabase_migrations`, `vault` и пользовательскую `public`.
В Timeweb переносится только `public`. Метаданные Storage читаются только для
переноса объектов.

Расширения источника:

- `plpgsql 1.0`;
- `pgcrypto 1.3`;
- `uuid-ossp 1.1`;
- `pg_stat_statements 1.11`;
- `supabase_vault 0.3.1`.

Пользовательская схема не вызывает `uuid_generate_*`, Vault или
`pg_stat_statements`. `gen_random_uuid()` доступен в PostgreSQL 17. Поэтому в
Timeweb обязательным остаётся только встроенный `plpgsql`; Supabase-служебные
расширения не переносятся.

## Public-объекты

В production обнаружено 33 таблицы:

`app_sessions`, `audit_logs`, `auth_rate_limits`, `avatar_assets`,
`cash_register_events`, `cash_registers`, `cookie_consents`,
`customer_avatars`, `customers`, `economics_settings`, `fiscal_receipts`,
`ingredients`, `inventory_items`, `inventory_movements`, `leads`,
`legal_consents`, `loyalty_accounts`, `loyalty_transactions`,
`order_inventory_deductions`, `order_item_ingredient_usage`,
`order_item_modifiers`, `order_items`, `orders`, `payment_events`, `payments`,
`product_images`, `product_ingredients`, `products`, `refunds`,
`site_settings`, `staff_users`, `vacancies`, `verification_codes`.

Каталог содержит:

- 124 индекса;
- 185 CHECK constraints;
- 31 foreign keys;
- 33 primary keys;
- 13 unique constraints;
- 9 update triggers;
- 12 public function signatures.

Критические функции перенесены:

- `create_site_order` (две сигнатуры);
- `set_order_status_atomic`;
- `set_order_status_staff_atomic`;
- `get_order_inventory_requirements`;
- `apply_inventory_movement_atomic`;
- три функции DB-backed rate limit.

Пользовательских enum и sequence нет. UUID генерируются `gen_random_uuid()`.

## RLS и grants

RLS включён на всех 33 таблицах. В Supabase публичный SELECT разрешён только для:

- `products`;
- `product_images`;
- `vacancies`;
- `avatar_assets`;
- `site_settings`.

Остальные таблицы закрыты для `anon` и `authenticated`; полный доступ имеет
только `service_role`.

При переносе в обычный PostgreSQL пять Data API policies для ролей
`anon/authenticated` намеренно исключаются: этих Supabase-ролей в Timeweb нет,
а браузер к PostgreSQL не подключается. RLS-флаги сохраняются. Таблицы создаёт
выделенный server-side пользователь Timeweb.

## Зависимости приложения

Data API используется серверным `@supabase/supabase-js` в actions, admin pages
и `src/lib/*`. Найдены операции `from`, `select`, `insert`, `update`, `upsert`,
`delete`, filters, ordering/count и RPC.

Supabase Storage используется в `src/lib/storage-images.ts` и admin upload
actions. Buckets:

- `products` (public, 0 объектов);
- `hero` (public, 6 объектов, 1 206 992 байта);
- `brand` (public, 0 объектов);
- `avatars` (public, 0 объектов).

Browser Supabase client существует, но импортов в рабочем коде не найдено.
Supabase Auth API, Realtime channels и Edge Functions приложением не
используются.

## Snapshot данных

| Таблица | Строк |
|---|---:|
| products | 33 |
| customers | 3 |
| vacancies | 3 |
| cookie_consents | 21 |
| legal_consents | 20 |
| avatar_assets | 38 |
| customer_avatars | 2 |
| loyalty_accounts | 3 |
| leads | 3 |
| ingredients | 2 |
| product_ingredients | 2 |
| app_sessions | 8 |
| audit_logs | 10 |
| economics_settings | 1 |
| site_settings | 1 |
| auth_rate_limits | 1 |
| orders / order_items | 0 / 0 |
| inventory_items / inventory_movements | 0 / 0 |

Остальные operational/payment/register таблицы на момент snapshot пусты.

## Backup

Файлы находятся вне Git и имеют права `0600`:

- `/Users/akimkovalenko/Desktop/karimoff-supabase-backup.dump`;
- `/Users/akimkovalenko/Desktop/karimoff-supabase-schema.sql`;
- `/Users/akimkovalenko/Desktop/karimoff-supabase-objects.txt`.

SHA-256:

- dump: `1ea45c8eeef32fded20137823557dc120dc499fcf6eb5b1ffed2fa81ab26dfa4`;
- schema: `34ed530f853736bd96639b185c48effa121269676c540b692d083ad134dada6a`;
- objects: `8cd5d29e55d036aca867b49533600d30b19868362b7aa21a4514b57bc8039082`.

## Вывод

Миграция `public` совместима с PostgreSQL 17. Единственные намеренные
расхождения — отсутствие Supabase-служебных схем/расширений и пяти Data API
policies. Они не нужны server-only PostgreSQL-архитектуре.
