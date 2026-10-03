# POS fiscal identity: handoff для release-интеграции

Эта ветка остаётся на RC `824f0f8`; не переносить её целиком в `main`. Основной
release-чат интегрирует только POS commits с ручным разбором пересечений.
Физическую оплату, установку Bridge на кассу и production deploy здесь не проводили.
При переносе сохранить зависимость от RC safety fix `bc8b7e8`: он сериализует
повторные попытки и удерживает UNKNOWN terminal payment за rollout gate.

## Облачный SELL

Официальная модель Эвотор содержит `document.id`, `device_id`, `store_id` и
`body.pos_print_results[]`. Parser принимает как плоский элемент массива, так
и вариант с вложенным `pos_print_result`. Каждая группа сохраняется в
`evotor_receipt_fiscal_groups` с порядковым индексом, `print_group_id`, ФН,
ФД, ФП, номером чека, номером документа и `check_sum`. Для документа с
несколькими группами scalar-фискальные поля `evotor_receipts` не получают
произвольно первую группу; после однозначной сверки в них пишется выбранная.

`tests/fixtures/evotor-sell-multi-group.synthetic.json` — синтетический пример
официальной структуры. Он **не** выдан за документ точки. Проверка реального
SELL ожидает обезличенный файл
`/Users/akimkovalenko/.codex/handoffs/KARIMOFF/evotor-real-sell-sanitized.json`.
Если он появится, сохранить только структуру и типы в отдельном коммитабельном
fixture, заменив реальные ID, суммы и названия синтетическими значениями.

## Сверка

Для каждой полной группы ищется paid intent по cloud device/store ID,
ФН/ФД/ФП и точке; сумма проверяется дополнительно. При ровно одной паре
`группа ↔ intent` проверяется, что эта же фискальная группа не встречается
в другом облачном SELL той же кассы. Тогда существующая запись
`analytics_sale_reconciliations` связывает документ с заказом. Ноль совпадений
остаётся `unreconciled`, несколько — `ambiguous`; сумма и время сами по себе
никогда не создают связь. Повторный импорт сохраняет ту же canonical sale.

## Миграция

Применять через migration-role после предыдущих миграций RC, включая
`20261003070000_runtime_role_permissions.sql`:

`20261003120000_pos_fiscal_identity.sql`.

Она добавляет cloud binding Bridge, local receipt UUID и фискальную
идентичность intent, статус сверки receipt, индексы уникальности UUID и
intent-фискального кортежа, lock на одну активную операцию терминала, таблицу
печатных групп и индекс ФН/ФД/ФП. Существующие обезличенные
`raw_metadata.body.pos_print_results` переносятся в новую таблицу без потери
групп. Runtime role получает только DML и RLS policy на новую таблицу; DDL
выполняет migrator. Старые migrations не изменены. Runtime runner проверяет
наличие таблицы, индекса и ключевых полей перед запуском приложения в режиме
read-only.

После применения проверить: таблица и индекс существуют, у `karimoff_app`
нет прав DDL, у него есть DML на группы; у оплаченного intent сохраняются
`order_id`, `payment_id`, `device_id`, local UUID, cloud device/store и
ФН/ФД/ФП. В admin → «Цепочка POS и чека» после импорта видны все группы
связанного документа.

Hardware checklist: [pos-physical-acceptance.md](./pos-physical-acceptance.md).
