# KARIMOFF: Timeweb rollback archive

Этот документ предназначен для аварийного восстановления. Он не содержит
пароли, connection strings или ключи.

## Точки восстановления

- последняя версия с двойным адаптером: `ba6a8e64792b016a86dd9e3c09c5dc9483470f77`;
- первый Timeweb-only runtime: `3ca01c7246e247f37103c1ebddcb632e1c7d4c64`;
- source backup:
  `/Users/akimkovalenko/Desktop/karimoff-final-supabase-backup.dump`;
- pre-cutover Timeweb backup:
  `/Users/akimkovalenko/Desktop/karimoff-timeweb-pre-cutover-backup.dump`;
- финальная инвентаризация:
  `/Users/akimkovalenko/Desktop/karimoff-final-timeweb-inventory.json`;
- защищённые migration credentials:
  `/Users/akimkovalenko/Desktop/KARIMOFF-migration.env`.

Все перечисленные файлы находятся вне Git и должны сохранять mode `0600`.

## Быстрый откат приложения

1. Включить `MAINTENANCE_MODE=true` в Timeweb App Platform.
2. Дождаться успешного redeploy и убедиться, что операции записи возвращают
   maintenance response.
3. Зафиксировать время остановки записей и сделать свежий dump Timeweb DB.
4. Развернуть commit
   `ba6a8e64792b016a86dd9e3c09c5dc9483470f77`.
5. Восстановить старые provider/env-настройки только из защищённого локального
   хранилища. Не переносить значения в Git, issue или логи.
6. Проверить `/`, `/menu`, `/login`, `/careers`, admin login и server logs.
7. Выключить maintenance только после проверки данных.

## Важное ограничение

После появления новых production-записей в Timeweb нельзя просто переключиться
на старый snapshot: будут потеряны пользователи, заказы, согласия и складские
движения после cutover. Перед таким откатом необходимо:

1. сохранить свежий Timeweb dump;
2. определить delta по `created_at`/`updated_at`;
3. перенести delta транзакционно;
4. сравнить row counts и последние бизнес-записи;
5. только затем открыть запись.

## Откат Timeweb DB

1. Включить maintenance.
2. Сделать текущий dump.
3. Восстанавливать backup только в отдельную временную database.
4. Сравнить 33 таблицы, 124 индекса, 31 FK, 12 функций и 9 триггеров.
5. Переключить `DATABASE_URL` только после read/write smoke-теста роли
   `karimoff_app`.

## Откат Storage

Исходные файлы не удалены автоматически. Карта соответствия:

`/Users/akimkovalenko/Desktop/karimoff-final-storage-url-map.json`

Перед сменой media base URL проверить object count, size, checksum,
`Content-Type`, `Cache-Control` и HTTP 200. Изменять URL только в выбранной
production database и только под maintenance.

## После периода наблюдения

Исходный облачный проект можно остановить или удалить только вручную после:

- подтверждённого срока хранения резервной копии;
- нескольких успешных backup/restore drills Timeweb;
- проверки реальных заказов, склада, бонусов и загрузок;
- ротации ранее раскрытого DB password;
- отдельного решения владельца проекта.
