# Уведомления о заказах

KARIMOFF ставит транзакционное уведомление в очередь только при переходе canonical kitchen status в `ready` или `cancelled`. Тестовые заказы исключены. Очередь не меняет заказ, выручку, склад, KDS или фискальные документы.

## Доставка

- Telegram: официальный Bot API `sendMessage`, получатель — подтверждённый Telegram provider ID. Login запрашивает scope `write`, который Telegram описывает как разрешение связанному боту отправлять личные сообщения.
- MAX: официальный `POST https://platform-api2.max.ru/messages?user_id=...`, bot token передаётся только в заголовке `Authorization`.
- Обе ссылки ведут только на `${APP_ORIGIN}/profile/orders`; session ID, order token и PII в URL не передаются.

Официальные разделы:

- https://core.telegram.org/bots/telegram-login
- https://core.telegram.org/bots/api#sendmessage
- https://dev.max.ru/docs-api/methods/POST/messages

## Надёжность

`order_notification_deliveries` имеет unique constraint `(order_id, identity_id, event_type)`. Worker забирает записи через `FOR UPDATE SKIP LOCKED`, восстанавливает зависшие lease, повторяет временные network/429/5xx ошибки с ограниченным backoff и прекращает повторы после постоянного отказа или восьми попыток. Raw provider payload, bot token и полный телефон не сохраняются и не логируются.

## Безопасное включение

По умолчанию отправка выключена:

```dotenv
ORDER_STATUS_NOTIFICATIONS_ENABLED=false
TELEGRAM_BOT_TOKEN=
```

`TELEGRAM_BOT_TOKEN` — отдельный BotFather token. Нельзя подставлять вместо него `TELEGRAM_OIDC_CLIENT_SECRET`. Для MAX используется существующий server-only `MAX_BOT_TOKEN`.

Перед `ORDER_STATUS_NOTIFICATIONS_ENABLED=true` нужно применить migration, проверить сертификатную цепочку контейнера для `platform-api2.max.ru`, сделать по одному разрешённому тесту на Telegram и MAX и убедиться, что статус доставки стал `sent`. Включение не отправляет исторические уведомления: migration создаёт очередь только для будущих status events.
