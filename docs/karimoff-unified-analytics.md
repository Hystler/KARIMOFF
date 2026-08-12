# Единая аналитика KARIMOFF

## 1. Архитектура

Операционные таблицы остаются источниками истины. Provider-neutral read-only слой состоит из:

- `analytics_sales` — продажи и возвраты;
- `analytics_sale_items` — позиции;
- `analytics_sale_payments` — оплаты;
- `analytics_sale_reconciliations` — подтверждённое устранение дублей web ↔ POS;
- server-only сервисов `src/lib/analytics`;
- UI `/admin/analytics` и журнала `/admin/analytics/sales`.

Browser получает готовые агрегаты. Финансовые суммы агрегируются PostgreSQL `numeric`; frontend только форматирует результат.

## 2. Источники и каналы

| Техническое значение | UI | Состояние |
| --- | --- | --- |
| `pos_evotor` | Касса | работает |
| `web` | Сайт | работает |
| `mobile` | Приложение | подготовлено, скрыто без данных |
| `aggregator` | Агрегаторы | подготовлено, скрыто без данных |

Эвотор используется только для чтения и аналитики. POS-импорт не списывает склад и не меняет каталог.

## 3. Метрики

- **Выручка**: сумма `net_revenue` включённых операций. POS sale положительный, POS return отрицательный; web — сумма завершённого заказа минус завершённый возврат.
- **Продажи / чеки**: количество sale-операций, признанных завершёнными. Возврат не создаёт новую положительную продажу.
- **Средний чек**: сумма продаж после скидки, до отдельной операции возврата, делённая на число продаж. Нулевой denominator даёт 0 без `NaN`.
- **Продано товаров**: количество позиций завершённых sale-операций. Возврат отражается отдельно.
- **Возвраты**: сумма возвратов и количество операций с `refund_amount > 0`.
- **Скидки**: фактическая скидка источника. Карточка скрывается, если источник не предоставляет эти данные.
- **Клиенты**: distinct известных `customer_id`. Неизвестные POS-покупатели не смешиваются с web users.

Если previous = 0, процент не показывается: результат отмечается как новый или как отсутствие базы сравнения.

## 4. Revenue rules

Формула: `gross revenue - discounts - refunds = net revenue`.

POS:

- `sale` входит в продажи и выручку;
- `return` уменьшает net revenue и увеличивает возвраты;
- `correction` хранится в журнале, но не включается в revenue без отдельного бизнес-правила.

Web:

- `new`, `in_progress`, `cancelled` не входят в revenue;
- `completed` входит только с допустимым `payment_status`;
- `failed` и `cancelled` payment не входят;
- completed refund уменьшает revenue.

## 5. Возвраты

Полный и частичный web-возврат берётся из `refunds`, когда запись есть, либо из `payment_status` для legacy-сценария. POS return является отрицательной операцией. Void/cancel не считается возвратной продажей.

## 6. Timezone

Текущая бизнес-зона — `Europe/Moscow`. Границы суток, часы heatmap и группировки вычисляются в ней, а не в UTC или timezone браузера. Следующее расширение для сети — timezone на location.

## 7. Периоды и сравнения

Доступны today, yesterday, 7/30 days, current/previous week, current/previous month, current quarter и custom range. По умолчанию используется непосредственно предшествующий период той же календарной длины. Дополнительно диапазон можно сдвинуть на неделю, месяц или год.

Granularity: один день — часы; до 31 дня — дни; до 180 дней — недели; длиннее — месяцы. Нулевые интервалы добавляются server-side.

## 8. Reconciliation

Подтверждённая запись web ↔ POS исключает POS-дубликат, сохраняя web как каноническую продажу и используя POS-оплату только при отсутствии web payment. Сумма, время и название товара сами по себе не являются надёжной связью.

## 9. Product mapping

POS line item использует внешний ID. Внутренний product ID и category появляются только при `evotor_product_mappings.status = confirmed`. Несопоставленные товары видимы в рейтинге и журнале.

Фильтр товара или категории выбирает чеки, в которых встречается позиция; KPI такого среза отражают полную сумму выбранных чеков. Товарные и категорийные рейтинги считают только соответствующие line items.

## 10. Database и запросы

Добавлены составные индексы для закрытых чеков по кассе/сотруднику, позиций по внешнему товару, completed web-заказов и product order items. Фильтры параметризованы, sort использует allowlist. Журнал применяет server pagination, CSV — keyset batches по 500 строк.

На PostgreSQL 17 репрезентативная агрегация выручки за 30 дней через `analytics_sales`, выполненная под ролью `karimoff_app`, заняла около 2 мс на локальном контрольном наборе (`21` shared-buffer hit; planning около `9,3` мс). План использует partial index подтверждённых reconciliation и индексы заказов/возвратов. Последовательное чтение крошечных тестовых таблиц ожидаемо; после накопления production-истории планы нужно измерить повторно до добавления preaggregation.

View сохраняет операционные данные и позволяет добавлять каналы отдельными `UNION ALL` ветками. Materialized view пока не нужен: текущий объём мал. При миллионах продаж следующим шагом будет дневная/hourly preaggregation после измерения реальных query plans.

## 11. Permissions

- owner: вся сеть;
- admin: вся сеть;
- manager: только `staff_location_access.location_key`;
- cook: analytics denied.

Пустой scope управляющего означает ноль доступных точек, а не доступ ко всей сети. Фильтрация выполняется в SQL. Экспорт использует тот же scope.

## 12. Cache и обновление

На текущем объёме server cache намеренно не включён: страница всегда видит результат последнего Evotor sync без redeploy. UI показывает `source_updated_at` и имеет ручной refresh. При росте объёма cache key обязан включать permission scope и все фильтры; manual sync должен инвалидировать соответствующие ключи.

## 13. UX

Фильтры живут в URL и переживают refresh. Реализованы comparison, KPI, trend chart, channel breakdown, revenue mix, heatmap, weekday, products, categories, employees, locations, terminals, payment mix, единый журнал, detail drawer, loading/error/empty states и responsive mobile cards.

## 14. Текущие ограничения

- нет подтверждённых product mappings, поэтому POS categories неизвестны;
- нет надёжного web ↔ POS reference;
- нет фактических web payments/refunds;
- частичный web-возврат без line-level allocation уменьшает выручку заказа, но не распределяется искусственно по товарам;
- нет отдельной location-таблицы и timezone каждой точки;
- food cost, gross profit, labor, ROAS, LTV и cohorts не показываются без достоверных данных;
- saved views оставлены extension point: URL уже является переносимым представлением.

## 15. Future sources

Mobile и aggregators добавляются как новые ветки нормализованных views или серверные adapters. Канал появляется в UI только после появления строк. Для commission/contribution margin потребуются фактические fees и mapping, а не нулевые заглушки.
