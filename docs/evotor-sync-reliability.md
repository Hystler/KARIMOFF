# Надёжная синхронизация Эвотор

## Официальная модель

- REST API авторизуется application token в `Authorization: Bearer <token>`: [обзор API](https://developer.evotor.ru/docs/rest_overview.html), [получение token](https://developer.evotor.ru/docs/rest_api_webhooks_post_user_token.html).
- `GET /stores/{store-id}/documents` принимает `since` включительно, `until` исключительно и `cursor=next_cursor`: [документы](https://developer.evotor.ru/docs/rest_api_get_store_documents.html).
- Типы включают `SELL`, `PAYBACK`, `RETURN`, `CORRECTION` и служебные документы. Их нельзя считать одной положительной продажей.
- Document webhook повторяется после отсутствия ответа за 10 секунд, но успешная доставка прямо не гарантируется: [webhook документов](https://developer.evotor.ru/docs/rest_api_webhooks_put_root.html).
- Document webhook использует user token стороннего сервиса, а callback application token — отдельный shared Bearer. Эти credentials не взаимозаменяемы: [авторизация webhook](https://developer.evotor.ru/docs/doc_evotor_api_authorization.html).

Точный публичный rate-limit в изученной документации не зафиксирован. Клиент соблюдает `429`, `Retry-After`/rate-limit reset, выполняет backoff и повторяет только безопасные GET.

## Причина прежней задержки

Token callback и installation event запускали initial sync, а дальнейшее обновление зависело от ручной кнопки. Новая продажа не создаёт повторный token callback. При delayed cloud upload разовый семидневный запрос не давал гарантии повторной проверки уже пройденного времени.

## Новая схема

### Initial

После подключения загружаются stores/devices/employees/products и ограниченное окно документов. Тяжёлая работа не выполняется в callback request.

### Incremental

- Для connection/store сохраняется high-water mark в `evotor_sync_cursors`.
- Следующий запрос начинается с overlap пять минут до watermark.
- Все страницы читаются по `next_cursor` до конца фиксированного `until`.
- Watermark продвигается только после успешного завершения всей серии.
- Внешний ID является уникальным; `source_hash` отличает обновившийся документ от неизменившегося.

### Reconciliation

- Каждые несколько часов повторно читается rolling window 72 часа.
- Nightly/reconciliation вызов может безопасно повторить тот же диапазон.
- Upsert не создаёт дубликаты, но обновляет delayed/changed receipt.

### Запуск

Есть три независимых пути:

1. Кнопки initial/incremental/reconciliation в `/admin/integrations/evotor`.
2. Защищённый `POST /api/internal/evotor/sync` для Timeweb scheduler.
3. Opt-in background worker постоянного Node.js контейнера.

Рекомендуемый production-вариант — Timeweb scheduler каждые 2 минуты для incremental и отдельный reconciliation каждые 6 часов. In-process worker включать только при гарантированно одном постоянно работающем instance; advisory lock не даёт двум workers синхронизировать одно connection одновременно.

Переменные:

- `EVOTOR_SYNC_SECRET` — Bearer для internal scheduler;
- `EVOTOR_BACKGROUND_SYNC=false|true`;
- `EVOTOR_INCREMENTAL_INTERVAL_SECONDS` — 60–900, default 120;
- `EVOTOR_RECONCILIATION_INTERVAL_HOURS` — 1–24, default 6.

Все workers, которые используют одну таблицу `evotor_connections`, обязаны иметь одинаковый
`EVOTOR_TOKEN_ENCRYPTION_KEY`. Worker сначала проверяет совместимость ciphertext локально и
не claim-ит общий event при несовпадении ключа. Поэтому тестовый контейнер с ошибочным ключом
не может перевести production connection в `uninstalled`.

Существующий envelope уже versioned: `v1.<iv>.<ciphertext>.<auth-tag>`, AES-256-GCM,
12-byte IV и 16-byte auth tag, компоненты в base64url. Для контролируемой ротации можно
временно задать предыдущие ключи через `EVOTOR_TOKEN_PREVIOUS_ENCRYPTION_KEYS`. Автоматическую
перезапись включает отдельный `EVOTOR_TOKEN_REENCRYPT_LEGACY=true`; её разрешают только после
остановки старых instances, которые не знают новый primary key.

## Retry и наблюдаемость

- timeout и exponential backoff для GET;
- безопасная обработка 401/403/429/5xx;
- `evotor_sync_events` и `evotor_sync_errors` сохраняют статус без Authorization;
- connection хранит last started/success/error, imported/updated/failed count и retry count;
- UI показывает cursor и время последнего события;
- structured logs не содержат token и покупательские данные.

## Гарантии

- KARIMOFF не пишет товары, цены или остатки в Эвотор.
- Импорт receipt не меняет inventory.
- Повторная синхронизация идемпотентна.
- Возврат не импортируется как положительная продажа.
- Пропущенный webhook восстанавливается polling/reconciliation.

## Проверка реальной задержки

После миграции и deploy тестового стенда:

1. Зафиксировать время нового read-only чека на кассе.
2. Дождаться incremental run.
3. Сверить external ID, `closed_at`, `created_at`/`synchronized_at`, позиции, кассу, сотрудника, оплату и total.
4. Повторить incremental и убедиться, что count не растёт.
5. Запустить reconciliation и убедиться, что итог не меняется.

Реальные production/test credentials и БД в локальной проверке этой ветки не использовались, поэтому фактическая latency не выдумывается и должна быть заполнена на стенде.
