# Интеграция YooKassa

## Границы интеграции

KARIMOFF использует API YooKassa v3 по адресу `https://api.yookassa.ru/v3` и HTTP Basic Auth. `shopId` и секретный ключ существуют только в server-side environment. Клиентские компоненты, URL возврата, metadata и operational logs не содержат credentials.

Интеграция не меняет read-only Evotor flow. YooKassa payment, чек YooKassa и импортированный Evotor receipt являются разными техническими объектами. Canonical business sale остается заказом KARIMOFF.

Официальные источники:

- [Формат API и идемпотентность](https://yookassa.ru/developers/using-api/interaction-format)
- [Входящие уведомления](https://yookassa.ru/developers/using-api/webhooks)
- [Чеки от YooKassa](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/yoomoney/basics)
- [Чеки при платежах](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/yoomoney/payments)
- [Справочник фискальных значений](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/yoomoney/parameters-values)
- [Чеки при возвратах](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/yoomoney/refunds)
- [Тестовые магазины](https://yookassa.ru/developers/payment-acceptance/testing-and-going-live/testing)

## Source of truth

Используются существующие сущности:

- `orders` — canonical order и независимые `payment_status`, `fiscal_status`, `kitchen_status`;
- `payments` — одна YooKassa payment attempt на web order;
- `payment_events` — идемпотентная обработка webhook deliveries;
- `refunds` — внутренние full/partial refund attempts;
- `fiscal_receipts` — чек предоплаты, чек зачета предоплаты и чек возврата;
- `order_outbox` — ровно одно событие открытия оплаченного заказа для operational consumers.

Добавлена только детализация существующих таблиц и `refund_items` для точного состава частичного возврата. Параллельной модели продаж нет.

## Payment flow

1. Backend заново валидирует активность товаров, модификаторы и цены.
2. В одной PostgreSQL transaction создаются canonical order и pending payment attempt. Сумма берется только из server-calculated order snapshot.
3. Web order получает `payment_required=true`, `payment_status=pending`, `is_operational=false` и не виден KDS.
4. KARIMOFF вызывает `POST /payments` с `capture=true`, `confirmation.type=redirect` и сохраненным `Idempotence-Key`.
5. Неизвестный результат POST восстанавливается повтором строго того же body и того же ключа.
6. Return page только показывает внутренний status. Она не признает платеж успешным по URL или query string.
7. Webhook либо reconciliation получает payment через `GET /payments/{id}`, проверяет provider ID, internal metadata, RUB и точную сумму.
8. Только verified `succeeded + paid=true` переводит заказ в `paid`, открывает `is_operational` и создает один `order.payment_succeeded` в outbox.

Маппинг provider state:

| YooKassa | KARIMOFF payment | Order/KDS |
| --- | --- | --- |
| `pending` | `pending` | не operational |
| `waiting_for_capture` | `pending` | не operational; для `capture=true` остается защитным состоянием |
| `succeeded` + `paid=true` | `paid` | operational, один outbox event |
| `canceled` | `cancelled` | отменен, в KDS не попадает |

Payment, order, fiscal и kitchen statuses не смешиваются.

## Fiscal receipt

В кабинете используется режим «Чеки от YooKassa».

Централизованная конфигурация строк чека:

- `vat_code=1` — без НДС;
- `payment_subject=commodity` — товар;
- `measure=piece`;
- начальный чек до выдачи: `payment_mode=full_prepayment`;
- чек зачета при `handed_out`: `payment_mode=full_payment`, settlement type `prepayment`.

Платные modifiers входят в snapshot цены основной позиции и перечисляются в ее description. Отдельная строка для add-on не создается: это сохраняет точное равенство суммы заказа и чека и не выдает ingredient за самостоятельный товар. Удаления и замены также видны в description.

Для «Чеков от YooKassa» чек доставляется только по email, поэтому checkout требует корректный email. SMS в этом режиме не поддерживается.

Патент задается в настройках магазина YooKassa. `tax_system_code` в payload «Чеков от YooKassa» не добавляется: этот параметр относится к сценариям сторонней онлайн-кассы. Перед первым платежом владелец должен подтвердить в кабинете, что система налогообложения указана как Патент, а классификация блюд как `commodity` согласована с бухгалтером.

`receipt_registration` хранится отдельно. Payment `succeeded` не подменяет подтверждение регистрации чека.

## Webhook

Production URL:

`https://karimoff.site/api/webhooks/yookassa`

В кабинете YooKassa, раздел «Интеграция → HTTP-уведомления», необходимо выбрать:

- `payment.waiting_for_capture`;
- `payment.succeeded`;
- `payment.canceled`;
- `refund.succeeded`.

Webhook публичный и не использует user session/CSRF. Он ограничивает размер body и частоту, валидирует форму уведомления и никогда не доверяет provider object из входящего JSON. Object ID повторно запрашивается у YooKassa по API; после этого проверяются metadata/order binding, payment ID, amount и currency. Повторная доставка имеет тот же normalized event key и не повторяет side effects. Permanent binding/validation rejection получает `200`, а config/auth/network/provider failure остаётся необработанным и получает `503`, чтобы YooKassa повторила доставку после восстановления.

## Reconciliation

Webhook не является единственной гарантией. PostgreSQL-backed worker забирает due rows через `FOR UPDATE SKIP LOCKED` с lease.

Базовый график pending status:

- первые 2 минуты — каждые 10 секунд;
- до 10 минут — каждые 30 секунд;
- до 1 часа — каждые 2 минуты;
- до 24 часов — каждые 15 минут;
- после 24 часов автоматический polling прекращается.

Для network/429/5xx используется exponential backoff с jitter и потолком 15 минут. Несколько app instances безопасны благодаря row leases. Worker обрабатывает payment, refund и закрывающие fiscal receipts.

После подтверждения payment/refund отдельный `receipt_registration=pending` проверяется до 72 часов. Это внутренний ограниченный recovery horizon KARIMOFF, а не обещанный YooKassa срок; он не продлевает ожидание самого платежа.

## Idempotency

- UI хранит один UUID checkout attempt на одну попытку оформления.
- `payments.idempotency_key` unique.
- YooKassa payment unique по provider ID и по canonical order.
- Request fingerprint запрещает повтор того же ключа с измененным body.
- `payment_events(provider, provider_event_id)` unique.
- KDS outbox key `order:{id}:payment:succeeded` unique.
- Refund ID, refund idempotency key и fiscal receipt idempotency key unique.
- DB trigger не позволяет payment-required order стать operational до verified payment.

## Return page

Route: `/checkout/payment/return`.

Страница доступна только владельцу заказа, получает status из KARIMOFF и показывает `pending`, `paid`, `cancelled/failed` или timeout. При timeout новая payment автоматически не создается. Пользователь может продолжить проверку той же попытки. Корзина очищается только после verified paid status.

В admin-карточке заказа действие «Проверить статус» выполняет только provider `GET /payments/{id}`. Recovery-`POST` с исходным Idempotence-Key доступен исключительно фоновому worker для случая, когда результат первоначального создания платежа неизвестен.

## Refunds

Refund service готов server-side, но production UI отсутствует.

- Full refund: `POST /refunds` без `receipt`; YooKassa использует исходные данные чека.
- Partial refund: обязательны exact order item allocations и receipt на возвращаемые позиции.
- Сумма не может превышать текущую refundable amount с учетом pending reservations.
- POST retry использует тот же idempotence key и body fingerprint.
- `refund.succeeded` и GET reconciliation сходятся идемпотентно.
- Создатель refund обязателен, проверяется как активный `owner/admin` и хранится как staff reference; причина обязательна. Secret/provider payload не сохраняется.
- Успешная provider payment остаётся `paid`; aggregate `partially_refunded/refunded` хранится на order и вычисляется из completed refunds. Это сохраняет действующую payment analytics и не смешивает платеж с операциями возврата.

Включение refund UI требует отдельного permission/feature decision и отдельного задания.

## Analytics и Evotor

YooKassa webhook не создает sale или `evotor_receipt`. Analytics учитывает canonical web order один раз после завершения и подтвержденной оплаты.

Текущие «Чеки от YooKassa» полностью формируются инфраструктурой YooKassa и не отправляются в физический Evotor ресторана. Evotor document возможен только при отдельном переходе на решение со сторонней онлайн-кассой и явной интеграции такой кассы с YooKassa.

Если в будущем связанный Evotor document все же появится, исключение дубля возможно только по доказанному external/fiscal reference либо после manual confirmation в `analytics_sale_reconciliations`. Сходство суммы и времени не является основанием для auto-merge. Подтвержденная связь исключает Evotor copy из analytics; canonical order, KDS и inventory остаются единственными business side effects.

## Environment

Server-only:

```env
PAYMENTS_ENABLED=false
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=
YOOKASSA_WEBHOOK_URL=https://karimoff.site/api/webhooks/yookassa
YOOKASSA_RETURN_URL=https://karimoff.site/checkout/payment/return
APP_ORIGIN=https://karimoff.site
```

Дополнительный `YOOKASSA_ENABLED` не используется. Checkout включается только при `PAYMENTS_ENABLED=true`, полной YooKassa configuration и `TEST_ORDER_MODE!=true`.

## Test stand

Production credentials запрещено копировать на стенд без отдельного подтверждения. Официальный безопасный вариант — отдельный test shop с отдельными `shopId` и secret key, test-origin return URL и отдельным webhook URL. При `PAYMENTS_ENABLED=false` provider create/refund не вызываются; UI сообщает, что online payment временно недоступен.

## Production rollout checklist

1. Создать или проверить test shop и пройти mocked + test-shop flow.
2. Подтвердить в production cabinet режим «Чеки от YooKassa», Патент и без НДС.
3. Утвердить и опубликовать актуальные условия онлайн-оплаты, отмены и возврата в оферте до включения эквайринга.
4. Добавить production env без вывода secret в logs.
5. Указать webhook URL и четыре события из раздела выше.
6. Проверить, что endpoint доступен по HTTPS, а `PAYMENTS_ENABLED=false`.
7. Выполнить controlled deploy и read-only smoke.
8. По отдельному разрешению включить payments только для минимального controlled real order.
9. Проверить `payment.succeeded`, receipt registration, email-чек, появление одного KDS order и одну analytics sale.
10. Проверить закрывающий чек после выдачи.
11. Только после reconciliation и бухгалтерской проверки расширять доступ всем пользователям.

До шагов 7–10 `PAYMENTS_ENABLED` остается `false`; реальные платежи и возвраты не выполняются.
