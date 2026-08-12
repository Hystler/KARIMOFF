# Интеграция KARIMOFF ERP с облаком Эвотор

## Назначение и границы

Интеграция получает данные из облака Эвотор по REST API v2 и сохраняет их в Timeweb PostgreSQL для отчётов KARIMOFF ERP. Первый этап работает только на чтение: приложение не меняет номенклатуру, цены и остатки Эвотор, не отправляет команды на кассу и не списывает ингредиенты по импортированным чекам.

Онлайн-заказы KARIMOFF продолжают списывать склад собственным транзакционным контуром. Таблица `evotor_product_mappings` подготовлена для будущего подтверждаемого сопоставления `KARIMOFF product ↔ Evotor product`, но импорт чеков не запускает складские движения. Это исключает двойное списание одного заказа после его фискализации.

## Официальный контракт

- При включённом параметре «Токен приложения для доступа к REST API Эвотор» облако выполняет `POST` на URL приложения. Тело запроса содержит `userId` и `token`; успешный ответ — `200 OK`.
- Для callback в кабинете выбирается авторизация Bearer. Значение должно совпадать с серверной переменной `EVOTOR_WEBHOOK_AUTH_TOKEN`.
- Запросы к `https://api.evotor.ru/` используют `Authorization: Bearer <application token>` и media type `application/vnd.evotor.v2+json`.
- Списки используют cursor-pagination. При `429` клиент учитывает `Retry-After`/`X-RateLimit-Reset` и повторяет только безопасные `GET`.
- События установки и удаления приходят отдельным `POST`; при ответе не `200` Эвотор повторяет доставку. Обработчик поэтому идемпотентен.

Официальные страницы: [автоматическая передача токена](https://developer.evotor.ru/docs/rest_api_webhooks_post_user_token.html), [авторизация](https://developer.evotor.ru/docs/doc_authorization_ref.html), [обзор REST API](https://developer.evotor.ru/docs/rest_overview.html), [события установки](https://developer.evotor.ru/docs/rest_api_webhooks_post_installation_event.html).

## Используемые API

| Данные | Метод |
| --- | --- |
| Магазины | `GET /stores` |
| Терминалы | `GET /devices` |
| Сотрудники | `GET /employees` |
| Номенклатура | `GET /stores/{store-id}/products` |
| Документы и чеки v2 | `GET /stores/{store-id}/documents` |

Первая синхронизация загружает документы только за последние 7 дней. Полная многолетняя история намеренно не запрашивается.

## Callback URL

- Токен приложения: `https://karimoff.site/api/integrations/evotor/token`
- События установки/удаления: `https://karimoff.site/api/integrations/evotor/installation`

Оба endpoint принимают только `POST`, требуют общий Bearer token, используют DB-backed rate limit и не возвращают токен Эвотор. Полученный application token шифруется AES-256-GCM; в базе дополнительно хранится HMAC fingerprint для идемпотентности.

Тяжёлая синхронизация не выполняется внутри callback. HTTP-запрос только сохраняет подключение и ставит событие в очередь `evotor_sync_events`; задача запускается через Next.js `after()`. Если процесс был остановлен, незавершённое событие остаётся со статусом `pending` и может быть повторно создано из админки.

## Переменные Timeweb

Только server-side:

- `EVOTOR_ENABLED=true`
- `EVOTOR_WEBHOOK_AUTH_TOKEN` — общий Bearer token для входящих callback; не application token Эвотор.
- `EVOTOR_TOKEN_ENCRYPTION_KEY` — ровно 32 случайных байта в base64 либо 64 hex-символа.
- `AUTH_RATE_LIMIT_SECRET` и `DATABASE_URL` — уже используются KARIMOFF.

Ни одна переменная Эвотор не имеет префикса `NEXT_PUBLIC_`. Старые `EVOTOR_API_TOKEN` и `EVOTOR_STORE_ID` больше не используются.

## Миграция и таблицы

Миграция: `supabase/migrations/20260812190000_add_evotor_cloud_integration.sql`.

Создаются:

- `evotor_connections` — зашифрованный токен, fingerprint и состояние подключения;
- `evotor_stores`, `evotor_devices`, `evotor_employees`;
- `evotor_products`, `evotor_product_mappings`;
- `evotor_documents`, `evotor_receipts`, `evotor_receipt_items`;
- `evotor_sync_events`, `evotor_sync_errors`;
- `integration_rate_limits` и функция `consume_integration_rate_limit`.

Уникальные ограничения на внешние ID делают повторный sync идемпотентным. Таблицы закрыты RLS, у публичных ролей нет прав; доступ выдаётся только серверной роли `karimoff_app`.

## Минимизация данных

В БД не сохраняются application token в открытом виде, Authorization, телефон/email покупателя, телефон сотрудника, IMEI и serial терминала. Фискальные реквизиты чека сохраняются только в объёме, необходимом для отчёта и последующей сверки.

## Админка

- `/admin/integrations/evotor` — состояние подключения, магазины, кассы, последний sync/ошибка, ручной sync и проверка соединения.
- `/admin/analytics/sales` — выручка, чеки, средний чек, возвраты, кассы, формы оплаты и популярные позиции.

Действия доступны администратору и управляющему. Повар перенаправляется в кухонный интерфейс. Серверные actions защищены текущей staff session, встроенной проверкой origin для Server Actions, DB rate limit и audit log.

## Что намеренно отключено

- запись в API Эвотор;
- изменение товаров, цен и остатков кассы;
- автоматическое сопоставление товаров без подтверждения;
- списание склада по импортированным чекам;
- автоматическое сопоставление онлайн-заказа с фискальным чеком;
- публикация и отправка приложения на review.

## ДЕЙСТВИЯ В КАБИНЕТЕ ЭВОТОР

1. Откройте приложение **KARIMOFF ERP** → раздел **Интеграция**.
2. Включите **«Токен приложения для доступа к REST API Эвотор»**.
3. В URL передачи токена вставьте: `https://karimoff.site/api/integrations/evotor/token`.
4. Выберите авторизацию **Bearer token / с помощью токена**.
5. Создайте случайный общий token, внесите одинаковое значение в кабинет Эвотор и серверную переменную Timeweb `EVOTOR_WEBHOOK_AUTH_TOKEN`.
6. Если в кабинете доступна настройка событий установки/удаления, укажите: `https://karimoff.site/api/integrations/evotor/installation` и тот же Bearer token.
7. В разрешениях REST API оставьте только чтение магазинов, терминалов, сотрудников, номенклатуры и документов/чеков. Не включайте изменение товаров, цен и остатков.
8. В Timeweb добавьте `EVOTOR_TOKEN_ENCRYPTION_KEY`, затем установите `EVOTOR_ENABLED=true` и перезапустите тестовый revision ветки.
9. Переустановите/обновите тестовую установку приложения, чтобы Эвотор повторно передал token.
10. Проверьте `/admin/integrations/evotor`, затем выполните «Проверить подключение» и «Синхронизировать».

Production не переключается этой веткой. Сначала примените миграцию на тестовой базе и проверьте реальные ответы кассы.
