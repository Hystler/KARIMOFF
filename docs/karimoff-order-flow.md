# Единый Order Flow KARIMOFF

## Канонический заказ

`orders` остаётся единственной бизнес-сущностью заказа. Каналы задаются `source`: `web`, `pos`, а подготовленные `mobile`, `kiosk`, `aggregator` не создают данные сами по себе. Внешний объект хранится в `source_external_id`; человекочитаемый номер не используется как ключ.

Новые поля разделяют четыре независимых состояния:

- `status` — бизнес-состояние;
- `kitchen_status` — `new`, `accepted`, `cooking`, `ready`, `handed_out`, `cancelled`;
- `payment_status` — оплата;
- `fiscal_status` — чек/фискализация.

Времена `accepted_at`, `cooking_started_at`, `ready_at`, `handed_out_at`, `cancelled_at` дают измеримый цикл заказа. Каждый переход пишется в `order_status_events`, чувствительные side effects получают событие `order_outbox` в той же транзакции.

## Создание заказа

Server-only `createOrder(source, input)` — общий вход для web и POS. Source adapter выбирает SQL RPC, но цена и состав строк заполняются общей функцией `populate_order_items_atomic`.

Сервер:

1. блокирует выбранные товары;
2. проверяет `is_active`, количества и модификаторы;
3. читает цены из PostgreSQL;
4. создаёт snapshots строк и фактического расхода ингредиентов;
5. считает total в `numeric`;
6. фиксирует legal consent для web;
7. создаёт outbox event.

Клиентская цена не принимается как источник истины. Повтор с тем же idempotency UUID возвращает существующий заказ.

## Нумерация

- web: `A-001`;
- POS и kiosk: `B-001`;
- будущие внешние каналы могут получить отдельный prefix после подтверждения процесса.

`order_number_counters` имеет ключ `(location_id, business_date, prefix)`. `INSERT ... ON CONFLICT ... DO UPDATE RETURNING` выдаёт последовательность атомарно. Дата рассчитывается в timezone точки и автоматически меняет счётчик на следующий день.

## Переходы

Обычная цепочка: `new → accepted → cooking → ready → handed_out`.

- Cook: принять, начать, готово.
- Cashier: создать POS-заказ, видеть очередь, выдать.
- Manager/admin: те же действия, отмена и override в разрешённых состояниях.
- Отмена после `ready` запрещена, пока не реализован атомарный обратный приход склада.

KDS проверяет expected current status и роль, а PostgreSQL повторно валидирует переход под `FOR UPDATE`.

## Склад: exactly once

Authoritative trigger текущей итерации — переход в `ready`. Он вызывает существующую транзакционную складскую RPC. В одной транзакции выполняются:

- lock заказа и ингредиентов;
- проверка остатка;
- движения `sale`;
- unique-запись `order_inventory_deductions`;
- бонусная операция;
- audit и статус заказа.

Повторный `ready` возвращает `already_applied` и ничего не списывает. Чеки Эвотор никогда не вызывают эту цепочку. Если рецептуры нет, заказ получает warning; silent deduction не выполняется. Политика block/warning/override для дефицита остаётся текущей и не меняется без бизнес-решения.

## Платежи и фискализация

Payment и fiscal lifecycle подготовлены, но provider disabled остаётся штатным состоянием. Web KDS gate и POS KDS gate задаются по точке в `kitchen_sla_settings`. До подключения онлайн-кассы можно не требовать `paid`; после подключения правило переключается настройкой, а не переписыванием статусов.

Фискальный чек должен хранить `order_id`. Сам чек является техническим подтверждением и не создаёт вторую бизнес-продажу.

## Realtime и восстановление

Business write и outbox event атомарны. PostgreSQL `NOTIFY` будит выделенный server-side `LISTEN`, а SSE `/api/order-events` отдаёт только события разрешённой location. Поток поддерживает `Last-Event-ID`, heartbeat и переподключение. 5-second server recovery check и 30-second browser refresh остаются controlled fallback; сервер всегда остаётся источником истины.

В браузерное событие не входят телефон, адрес, email и комментарий. После reconnect интерфейс перечитывает актуальную очередь, поэтому потерянный transient event не означает потерю состояния.

## Права

| Роль | Доступ |
| --- | --- |
| owner | вся сеть и настройки |
| admin | все операционные данные |
| manager | только назначенные точки |
| cashier | POS, очередь, выдача назначенной точки |
| cook | KDS назначенной точки |

Runtime role получает только необходимые grants/RLS. Browser не получает `DATABASE_URL` и не выполняет SQL напрямую.

## Миграция

Файл: `supabase/migrations/20260814120000_add_canonical_order_flow_kds.sql`.

Миграция additive и idempotent: существующие orders backfill-ятся в default location, старые completed/cancelled/in_progress получают соответствующий kitchen status. Перед тестовым deploy её нужно применить migration/schema-owner ролью и затем проверить RPC от `karimoff_app`.

## Уточнение POS/KDS 2026-08-15

Дополнительная миграция: `supabase/migrations/20260815103000_refine_pos_kds_display_operations.sql`.

Она добавляет:

- `orders.is_operational`, `operational_started_at`, `is_test`;
- item note и immutable configuration snapshot;
- группы и опции модификаторов с single/multi, min/max и remove/add/replace;
- snapshot выбранных опций в `order_item_modifiers`;
- effective ingredient usage с учётом удаления, добавки и замены;
- перегрузки web/POS RPC с server-only `p_is_test`;
- фильтрацию test orders из canonical sales analytics;
- RLS, grants и runtime migration check.

Legacy rows получают безопасные значения по умолчанию и не переводятся в operational автоматически. Новый order становится operational только в текущих create-order RPC. Поэтому история остаётся на месте, а рабочая очередь начинается с явной границы.

Клиент отправляет только ID, количество и выбранную конфигурацию. PostgreSQL проверяет разрешения модификатора, обязательность группы, min/max, active product и вычисляет `base price + server price deltas`. Browser price не участвует в записи.

В test mode статус `ready` обновляет только заказ, timeline и outbox. Вызов `set_order_status_staff_atomic`, а значит inventory deduction, loyalty и fiscal side effects, пропускается. В production при `TEST_ORDER_MODE=false` authoritative trigger остаётся прежним: exactly-once deduction на `ready`.
