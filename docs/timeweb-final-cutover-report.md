# KARIMOFF: final Timeweb cutover report

Дата завершения: 30 июля 2026 года (Europe/Moscow).

## Итог

Production `https://karimoff.site` переведён на:

- Timeweb Cloud PostgreSQL 17.10;
- runtime-роль `karimoff_app` с приватным адресом внутри сети Timeweb;
- Timeweb S3 bucket `karimoff-public-media`;
- Timeweb App Platform `karimoff-production`.

Активный код cutover: `3ca01c7246e247f37103c1ebddcb632e1c7d4c64`.

Production revision после удаления старых env:
`ed9f8117-bc1c-44f0-ac73-824454bc291b` (`success`).

Тестовый стенд `timeweb-cutover-test` также работает на точном commit
`3ca01c7246e247f37103c1ebddcb632e1c7d4c64`.

## Окно обслуживания

- Включение maintenance-контура: 30.07.2026, около 02:49 MSK.
- Возврат production в рабочий режим: 30.07.2026, около 03:24 MSK.
- Во время окна публичное чтение оставалось доступно, операции записи были
  закрыты.
- После проверки `MAINTENANCE_MODE=false`.

## PostgreSQL

Финальная read-only инвентаризация:

- таблиц: 33;
- строк: 163;
- индексов: 124;
- primary keys: 33;
- foreign keys: 31;
- unique constraints: 13;
- check constraints: 25;
- функций: 12;
- триггеров: 9;
- таблиц с RLS: 33.

| Таблица | Строк |
| --- | ---: |
| app_sessions | 8 |
| audit_logs | 10 |
| auth_rate_limits | 1 |
| avatar_assets | 38 |
| cash_register_events | 0 |
| cash_registers | 0 |
| cookie_consents | 25 |
| customer_avatars | 2 |
| customers | 3 |
| economics_settings | 1 |
| fiscal_receipts | 0 |
| ingredients | 2 |
| inventory_items | 0 |
| inventory_movements | 0 |
| leads | 3 |
| legal_consents | 28 |
| loyalty_accounts | 3 |
| loyalty_transactions | 0 |
| order_inventory_deductions | 0 |
| order_item_ingredient_usage | 0 |
| order_item_modifiers | 0 |
| order_items | 0 |
| orders | 0 |
| payment_events | 0 |
| payments | 0 |
| product_images | 0 |
| product_ingredients | 2 |
| products | 33 |
| refunds | 0 |
| site_settings | 1 |
| staff_users | 0 |
| vacancies | 3 |
| verification_codes | 0 |

Контрольный отчёт сохранён вне Git:

`/Users/akimkovalenko/Desktop/karimoff-final-timeweb-inventory.json`

## Storage

- исходных buckets: 4;
- объектов: 6;
- общий размер: 1 206 992 bytes;
- checksum source/target: совпадает для всех объектов;
- публичная проверка: HTTP 200 для всех объектов;
- обновлено URL в Timeweb DB: 6;
- оставшихся рабочих URL исходного Storage в Timeweb DB: 0.

Карты переноса сохранены вне Git:

- `/Users/akimkovalenko/Desktop/karimoff-final-storage-url-map.json`
- `/Users/akimkovalenko/Desktop/karimoff-final-storage-rewrite-report.json`

## Runtime

- удалён клиент `@supabase/supabase-js`;
- удалены browser/server clients прежнего Data API;
- PostgreSQL и S3 являются единственными runtime-адаптерами;
- `DATABASE_PROVIDER` и `STORAGE_PROVIDER` удалены;
- старые URL удалены из CSP и Next Image remote patterns;
- старые build args удалены из Dockerfile;
- `DATABASE_URL` и S3 secret остаются server-only;
- production и stand не содержат `SUPABASE_*` и публичные ключи прежнего
  провайдера.

Исторические SQL migrations, migration scripts и документы сохранены только
для аудита и аварийного восстановления. Они не копируются в standalone runtime
image и не выполняются приложением.

## Проверки

- `npm run lint`: pass;
- `npm run typecheck`: pass;
- `npm test`: 27/27 pass;
- `npm run build`: pass;
- `npm audit --omit=dev`: 0 vulnerabilities;
- `docker build -t karimoff .`: pass;
- Docker runtime smoke: HTTP 200;
- runtime image secret/provider scan: 0 forbidden files;
- production `/`, `/menu`, `/login`, `/careers`: HTTP 200;
- production `/admin`: HTTP 307 на admin login;
- browser Network `/` и `/menu`: 0 запросов к прежнему backend;
- production и stand logs: 0 прежних backend URL, 0 DB/S3 connection errors;
- тест регистрации, входа, заказа, склада, бонусов и admin/kitchen: pass;
- тест нескольких product images и hero upload/delete в S3: pass;
- тестовые данные удалены, финальные row counts восстановлены.

## Backups

Финальный source backup находится вне Git:

`/Users/akimkovalenko/Desktop/karimoff-final-supabase-backup.dump`

Дополнительно сохранены schema, data, object list, grants, extensions и row
count reports рядом с backup. Все защищённые файлы имеют mode `0600`.

Исходный облачный проект не удалён и оставлен как аварийный архив. Порядок
отката описан в `docs/timeweb-rollback-archive.md`.
