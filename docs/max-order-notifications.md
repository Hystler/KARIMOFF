# MAX-уведомления KARIMOFF

## Что проверено и подготовлено

- MAX Login валидирует подпись Mini App `initData`, свежесть и challenge. `provider_user_id` строится только из подписанного `user.id`, в каноническом положительном формате, без ведущих нулей и за пределами signed `int64`.
- MAX identity привязывается к существующему аккаунту по provider ID. При конфликте владельца вход отклоняется; совпадения по имени, username, фото и неподтверждённому локальному телефону не используются.
- Текущая очередь создаёт уникальную запись по заказу, identity и событию `ready/cancelled`; тестовые заказы исключены. Текст содержит номер заказа и ведёт кнопкой в `/profile/orders`.
- Подготовлен webhook на том же Next.js сервере для событий `bot_started`, `bot_stopped` и `dialog_removed`. Он проверяет `X-Max-Bot-Api-Secret` и записывает состояние только для уже привязанной MAX identity; в таблице хранится ссылка на identity, разрешение, тип и время события. ID пользователя, сырые события, имена и payload повторно не сохраняются.
- MAX события не попадают к отправке, пока пользователь не запустил бота. Остановка бота снимает разрешение. Webhook state проверяется при claim и непосредственно перед POST. События одной MAX identity ограничены одним отправлением в секунду, что ниже документированного лимита MAX — двух сообщений в секунду на диалог.
- POST идёт на `platform-api2.max.ru`, токен передаётся только через `Authorization`; успех принимается только с непустым `message.body.mid`. 429 повторяется с `Retry-After`, максимум восемь попыток. 5xx, timeout, сетевой обрыв и неполный 2xx для MAX не повторяются автоматически: исход POST может быть неизвестен.
- Добавлен отдельный one-recipient canary. Он не использует общую очередь, сначала сверяет linked MAX identity, активный `bot_started`, bot username через read-only `GET /me` и HTTPS URL кабинета. Отправка требует отдельного флага, выключенного worker и явного `--confirm-recipient` с точным совпадением allowlist ID. При сетевой неопределённости canary не повторяется.

Уникальная запись в БД предотвращает повторное создание одинакового события. Это не exactly-once гарантия MAX API: после неизвестного результата сообщение могло быть принято. Выбран режим без автоматического повтора такого результата, чтобы снизить риск дубля.

## Конфигурация MAX webhook

В уже существующем приложении используется адрес:

```text
https://<APP_ORIGIN>/api/integrations/max/webhook
```

`MAX_BOT_WEBHOOK_SECRET` — отдельный секрет webhook, а не bot token. После установки миграции и настройки HTTPS в MAX нужно зарегистрировать подписку только на события доступа:

```json
{
  "url": "https://<APP_ORIGIN>/api/integrations/max/webhook",
  "update_types": ["bot_started", "bot_stopped", "dialog_removed"],
  "secret": "<MAX_BOT_WEBHOOK_SECRET>"
}
```

Подписку нужно проверить через `GET /subscriptions`. MAX принимает только доверенный HTTPS endpoint; запросы webhook должны содержать `X-Max-Bot-Api-Secret`. Регистрация подписки и изменение внешней конфигурации в этой задаче не выполнялись.

## Проверка накопленной очереди

Перед любым включением owner/admin открывает `/admin/notifications`. Экран читает только агрегаты по всей очереди и последние 50 записей: pending/retry/processing/sent/permanent failure/superseded, просроченный срок, зависшие lease и ожидание дольше суток. В карточке нет recipient ID, телефонных данных или provider payload.

Все pending/retry MAX записи нужно сверить с текущим статусом заказа и возрастом. Старые отмены, неактуальные события и события без доступного получателя нельзя включать вслепую. Само включение worker может начать обработку накопленной очереди; этот код не очищает и не переписывает её.

Текущие production-счётчики, значение production-флага и применённость миграций недоступны из этой рабочей среды: `DATABASE_URL` отсутствует. Исторический аудит от 8 сентября 2026 не подтверждает состояние на текущую дату. Внешняя конфигурация, БД и production этой задачей не менялись; worker здесь не включался.

## Безопасный recipient canary

Настроить только для одного заранее разрешённого MAX аккаунта:

```dotenv
MAX_NOTIFICATION_TEST_RECIPIENT_ID=<разрешённый MAX user ID>
MAX_NOTIFICATION_TEST_SEND_ENABLED=false
ORDER_STATUS_NOTIFICATIONS_ENABLED=false
```

Сначала пользователь должен привязать MAX identity к KARIMOFF аккаунту и запустить бота; webhook должен записать `bot_started`. Затем read-only preflight проверяет точную привязку, токен и bot username. Он делает `GET /me`, выполняет только `SELECT` к БД и не отправляет сообщение:

```bash
node scripts/max-notification-canary.mjs --preflight-only
```

После отдельного разрешения на одну тестовую отправку включить `MAX_NOTIFICATION_TEST_SEND_ENABLED=true` только для этой операции и выполнить:

```bash
node scripts/max-notification-canary.mjs --confirm-recipient="$MAX_NOTIFICATION_TEST_RECIPIENT_ID"
```

Canary отправляет ровно одно нейтральное тестовое сообщение с кнопкой кабинета. Он не создаёт заказ, не читает и не меняет очередь и не повторяет POST. Реальная отправка не выполнялась: разрешённый recipient ID и отдельное разрешение на сообщение ещё не предоставлены.

## Что требуется перед включением

- Применить новую миграцию в согласованной среде; до этого MAX claim заблокирован.
- Задать `MAX_BOT_WEBHOOK_SECRET` и проверить live-подписку через MAX API.
- Read-only сверить накопившуюся очередь и подтвердить, что исторические записи можно обрабатывать.
- Подтвердить текущую production-конфигурацию и HTTPS/TLS trust для `platform-api2.max.ru`.
- Для реального canary указать один разрешённый MAX user ID и отдельно разрешить одну отправку.
- Включение общих production-уведомлений остаётся отдельным будущим действием и не включено этой веткой.

## Сверенные официальные требования MAX

- `POST /messages`: `https://dev.max.ru/docs-api/methods/POST/messages` — `platform-api2.max.ru`, token в `Authorization`, link-кнопки, до двух сообщений в секунду одному диалогу, успешная форма `message`.
- Webhook: `https://dev.max.ru/docs-api/methods/POST/subscriptions` — HTTPS и проверка `X-Max-Bot-Api-Secret`.
- Состояние бота: `https://dev.max.ru/docs-api/objects/Update` — события `bot_started`, `bot_stopped` и `dialog_removed`.
