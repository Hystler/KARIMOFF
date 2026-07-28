# KARIMOFF: верификация Timeweb PostgreSQL и S3

Дата проверки: 2026-07-28.

## Назначение

- Кластер Timeweb: PostgreSQL 17.10, 2 vCPU, 4 GB RAM, 40 GB disk.
- Тестовая база: `karimoff_migration`.
- Отдельные пользователи миграции и runtime-приложения созданы.
- URI и ключи хранятся только в
  `/Users/akimkovalenko/Desktop/KARIMOFF-migration.env` (`0600`).
- `DATABASE_PROVIDER` production-приложения не менялся.

## Результат импорта

Импорт выполнен из custom-format dump с `--no-owner --no-privileges`.
Исключены только:

- создание уже существующей Timeweb-схемы `public`;
- комментарий на эту схему;
- пять Supabase policies, зависящих от ролей `anon/authenticated`.

Сравнение source -> target:

| Проверка | Source | Target | Результат |
|---|---:|---:|---|
| Public tables | 33 | 33 | совпадает |
| Indexes | 124 | 124 | совпадает |
| CHECK | 185 | 185 | совпадает |
| Foreign keys | 31 | 31 | совпадает |
| Primary keys | 33 | 33 | совпадает |
| UNIQUE | 13 | 13 | совпадает |
| RLS-enabled tables | 33 | 33 | совпадает |
| Public functions | 12 | 12 | совпадает |
| Triggers | 9 | 9 | совпадает |
| Supabase Data API policies | 5 | 0 | намеренно |
| Timeweb server app policies | 0 | 33 | намеренно |

Точные row counts совпали по всем 33 таблицам. Максимальные timestamps у
`products`, `customers`, `loyalty_accounts`, `site_settings`, `vacancies` и
`cookie_consents` также совпали.

Для приложения создана отдельная server-only роль `karimoff_app`. На уровне
Timeweb ей оставлены только `SELECT`, `INSERT`, `UPDATE`, `DELETE`; отозваны
`CREATE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` и `TEMPORARY`. Для всех 33 таблиц
созданы RLS policies только для этой роли. Migration user не должен
использоваться приложением.

## Транзакционная проверка

В Timeweb под ограниченной ролью `karimoff_app` выполнен тест
`create_site_order` внутри `BEGIN ... ROLLBACK`. В payload намеренно передана
ложная цена. Записанный `order_items.unit_price` сравнён с `products.price`:
цена 430 рублей взята сервером из БД, а не из payload. Транзакция полностью
откачена, row counts после теста не изменились.

Критические функции склада, статусов и loyalty перенесены без изменения
определений. Сценарий отрицательного склада и двойного списания покрыт
существующими тестами проекта; live completed-order тест сейчас невозможен без
складских карточек, потому что production snapshot содержит 0 inventory rows.

## Storage

Timeweb bucket: `karimoff-public-media` (public), endpoint
`https://s3.twcstorage.ru`, region `ru-1`.

Перенесены и проверены шесть объектов:

- `hero/about.webp`;
- `hero/business.webp`;
- `hero/careers.webp`;
- `hero/franchise.webp`;
- `hero/home.webp`;
- `hero/menu.webp`.

Итого: 6 объектов, 1 206 992 байта. Для каждого выполнен HEAD и подтверждены
HTTP 200 и точный Content-Length. Дополнительно успешно выполнен
upload/head/delete временного smoke-объекта.

Карта URL:
`/Users/akimkovalenko/Desktop/karimoff-storage-url-map.json` (`0600`).
Supabase-объекты не удалялись, сохранённые URL production не менялись.

## Application smoke

Локально и в Docker запущен режим с отдельной ограниченной app-role:

- `DATABASE_PROVIDER=postgres`;
- `STORAGE_PROVIDER=s3`;
- payments disabled.

HTTP 200 получен для `/`, `/menu`, `/login`, `/careers`. В HTML подтверждены
импортированные товары, три вакансии и site settings. Production Timeweb app
по-прежнему использует Supabase.

## Расхождения и ограничения

1. Пять Supabase Data API policies не переносятся намеренно.
2. Supabase-служебные схемы не переносятся.
3. Stored image URLs переключаются отдельным dry-run/apply инструментом только
   в окно финальной синхронизации.
4. После snapshot источник может получить новые записи. Перед cutover нужен
   новый dump и повторный импорт в maintenance window.
5. Финальный `DATABASE_PROVIDER=postgres` и `STORAGE_PROVIDER=s3` запрещено
   включать без отдельного подтверждения владельца.
