# KARIMOFF: план переключения на Timeweb

## Новые runtime variables

Для production App Platform после подтверждения:

- `DATABASE_PROVIDER=postgres`;
- `DATABASE_URL` — private Timeweb PostgreSQL URI роли `karimoff_app`;
- `STORAGE_PROVIDER=s3`;
- `S3_ENDPOINT`;
- `S3_REGION`;
- `S3_BUCKET`;
- `S3_ACCESS_KEY_ID`;
- `S3_SECRET_ACCESS_KEY`;
- `S3_PUBLIC_BASE_URL`.

`DATABASE_URL` и S3 secrets являются server-only. Их нельзя объявлять как
`NEXT_PUBLIC_*`, передавать в Docker build args или коммитить.

Migration URI используется только из локального защищённого файла для
dump/restore и никогда не добавляется в App Platform.

До cutover остаются:

- `DATABASE_PROVIDER=supabase`;
- `STORAGE_PROVIDER=supabase`;
- текущие Supabase variables.

## Окно обслуживания

Рекомендуемое окно: 20-30 минут вне часов заказов.

1. Зафиксировать commit/deploy, прошедший проверки.
2. Включить maintenance/остановить приём новых регистраций, leads и orders.
3. Убедиться, что активных admin-операций нет.
4. Создать новый final dump source и контрольные суммы.
5. Повторно очистить только объекты, принадлежащие migration user в тестовой
   Timeweb DB, и восстановить свежий dump.
6. Повторно применить grants/RLS для `karimoff_app`.
7. Повторить exact row-count verification.
8. Повторить idempotent S3 transfer.
9. Запустить dry run URL mapping, затем `--apply`.
10. Проверить postgres/s3 smoke и Docker container.
11. Внести новые runtime variables в Timeweb App Platform.
12. Переключить providers и выполнить один deploy.
13. Проверить регистрацию, вход, меню, order, admin, inventory, loyalty и upload.
14. Открыть приём заказов.

## Команды финальной синхронизации

Все URI читаются из env и не печатаются:

```bash
node scripts/migration/postgres-container.mjs dump \
  /Users/akimkovalenko/Desktop/karimoff-supabase-final.dump

MIGRATION_ENV_PATH=/Users/akimkovalenko/Desktop/KARIMOFF-migration.env \
DATABASE_URL_NAME=TARGET_DATABASE_URL \
node scripts/migration/postgres-container.mjs query \
  "drop owned by karimoff_migrator"

MIGRATION_ENV_PATH=/Users/akimkovalenko/Desktop/KARIMOFF-migration.env \
DATABASE_URL_NAME=TARGET_DATABASE_URL \
node scripts/migration/postgres-container.mjs restore \
  /Users/akimkovalenko/Desktop/karimoff-supabase-final.dump

node scripts/migration/configure-timeweb-app-role.mjs
node scripts/migration/transfer-storage.mjs
node scripts/migration/rewrite-storage-urls.mjs
node scripts/migration/rewrite-storage-urls.mjs --apply
```

`drop owned` допустим только в выделенной `karimoff_migration` DB и только в
подтверждённом maintenance window. После restore обязательно повторно запустить
`configure-timeweb-app-role.mjs`, потому что grants и RLS app-role являются
частью post-restore конфигурации.

## Rollback

1. Не удалять и не модифицировать Supabase source.
2. Сохранить Supabase env variables в Timeweb.
3. При проблеме вернуть:
   - `DATABASE_PROVIDER=supabase`;
   - `STORAGE_PROVIDER=supabase`.
4. Выполнить redeploy предыдущего проверенного commit.
5. Заказы, созданные после cutover в Timeweb, перед rollback отдельно
   экспортировать; не выполнять слепое двустороннее слияние.

## Ручные действия владельца

Только после просмотра verification report:

1. Подтвердить maintenance window.
2. Подтвердить финальный sync.
3. Добавить/заменить server-only variables в Timeweb App Platform.
4. Подтвердить provider cutover.

До этого production продолжает работать с Supabase.
