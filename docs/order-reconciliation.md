# Reconciliation заказа и чека

## Проблема

Одна физическая продажа может существовать как:

- web/POS order KARIMOFF;
- payment;
- fiscal receipt;
- импортированный Evotor receipt.

Это разные технические записи, но не разные продажи. Импортировать чек как второй order или повторно списывать по нему склад запрещено.

## Текущая модель

`analytics_sale_reconciliations` связывает `orders.id` и `evotor_receipts.id`. Оба объекта сохраняются неизменными. Подтверждённая связь заставляет `canonical_analytics_sales` считать order как каноническую продажу и исключать receipt-дубль.

Ограничения гарантируют не более одной подтверждённой связи на order и receipt. Создание/удаление связи требует owner/admin/manager, location scope, staff session и audit.

Интерфейс: `/admin/integrations/evotor/reconciliation`.

## Что считается надёжной связью

Автоматическое подтверждение допустимо только при точном внешнем reference, например:

- `order_id` в metadata фискального запроса;
- payment/fiscal provider reference, сохранённый с обеих сторон;
- заранее переданный POS internal UUID, возвращённый Эвотором без изменения.

Не являются достаточным доказательством:

- одинаковая сумма;
- близкое время;
- похожее имя;
- одинаковый набор товаров;
- одинаковый display number без location/date/source.

Сейчас UI показывает сумму и время только для ручной проверки и не применяет автоматический fuzzy match.

## Склад

Склад списывает только канонический order при `ready`. Ни создание reconciliation, ни импорт receipt не создают `inventory_movements`. Удаление связи также не возвращает и не списывает сырьё.

## Будущая онлайн-касса

1. `createOrder` создаёт order UUID.
2. Payment request получает тот же idempotency/reference.
3. Fiscal request сохраняет `order_id` и provider reference.
4. Полученный fiscal/Evotor receipt связывается по точному reference.
5. Unified analytics считает одну business transaction.

До появления такого поля сопоставление остаётся ручным.
