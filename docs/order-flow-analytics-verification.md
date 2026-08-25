# Проверка Order Flow и аналитики

## Автоматическая локальная проверка

Миграции применены с нуля в PostgreSQL 17 и повторно применены идемпотентно. Проверка ограниченной роли `karimoff_app` подтвердила:

- создание POS order `B-001`;
- повтор idempotency key возвращает тот же order;
- переходы `new → accepted → cooking → ready`;
- второй `ready` не создаёт второе списание;
- контрольный остаток для 2 × 10 единиц изменился с 100 до 80;
- создана одна deduction и одно sale movement;
- browser roles не получили прямой write-доступ.

Тестовые данные находились только в локальном временном контейнере и не связаны с Timeweb.

## Таблица сверки

| Слой | Проверено локально | Реальный стенд |
| --- | --- | --- |
| raw Evotor receipts | схема/idempotent importer | требуется incremental sync |
| canonical orders | создание и lifecycle | требуется безопасный POS test marker |
| inventory | exactly once | реальные остатки не тронуты |
| unified analytics | confirmed link исключает receipt | требуется сверка totals после deploy |
| realtime | SSE contract/fallback tests | требуется browser reconnect test |

Реальные row counts, external IDs, суммы и latency здесь намеренно не указаны: ветка не подключалась к production Timeweb и не меняла реальные данные.

## Ручная сверка стенда

1. Применить `20260814120000_add_canonical_order_flow_kds.sql` migration-owner ролью.
2. Проверить EXECUTE RPC и RLS под `karimoff_app`.
3. Развернуть commit ветки с payment/fiscal disabled.
4. Выполнить read-only incremental Evotor sync и записать newest receipt count/latency.
5. Создать только маркированный тестовый POS order с отдельным безопасным ingredient либо без складского перехода.
6. Проверить KDS, display и status history.
7. Сопоставить тестовый order/receipt вручную и сравнить raw receipt, canonical sale и analytics total.
8. Удалить только созданные test-marker данные.
