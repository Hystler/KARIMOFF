# POS fiscal identity: handoff для release-интеграции

Эта ветка остаётся на RC `824f0f8`; не переносить её целиком в `main`. Основной
release-чат интегрирует только POS commits с ручным разбором пересечений.
Физическую оплату, установку Bridge на кассу и production deploy здесь не проводили.
При переносе сохранить зависимость от RC safety fix `bc8b7e8`: он сериализует
повторные попытки и удерживает UNKNOWN terminal payment за rollout gate.

## Облачный SELL

Read-only handoff одного существующего SELL документа точки подтвердил:
`document.id`, `device_id`, `store_id` — строки, `number` — число,
`body.sum` и `body.result_sum` — числа. `body.pos_print_results` — массив
из одного **плоского** объекта. В нём ФН и ФП — строки, ФД, `receipt_number`,
`document_number`, `check_sum` и `session_number` — числа; также присутствуют
`print_group_id`, `kkt_reg_number`, `kkt_serial_number` и `receipt_date`.
Ни один реальный идентификатор или персональные данные в репозиторий не добавлены.
Parser уже поддерживал эту фактическую структуру; доработки кода не потребовались.
Он также принимает вариант с вложенным `pos_print_result`. Каждая группа сохраняется в
`evotor_receipt_fiscal_groups` с порядковым индексом, `print_group_id`, ФН,
ФД, ФП, номером чека, номером документа и `check_sum`. Для документа с
несколькими группами scalar-фискальные поля `evotor_receipts` не получают
произвольно первую группу; после однозначной сверки в них пишется выбранная.

`tests/fixtures/evotor-sell-multi-group.synthetic.json` — синтетический пример
официальной структуры для проверки нескольких групп. Отдельный
`tests/fixtures/evotor-sell-real-shape.synthetic.json` создан по обезличенному
production-shape документу: совпадают ключи, типы и число групп, все значения
заменены синтетическими. Исходный read-only handoff находится вне репозитория и
не изменён. Санитайзер не сохраняет `kkt_serial_number` в `raw_metadata`;
фискальные реквизиты для сверки сохраняются в отдельной таблице полностью.

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

## Финальное подтверждение

Реальный SELL shape проверен read-only. На fixture с этой же структурой
PostgreSQL test запускает настоящий `persistSnapshot` importer: bridge-before-import,
import-before-bridge и повторный import сохраняют точную связь по device/store и
ФН/ФД/ФП, одну canonical sale, один KDS event и одно списание.
Отдельные synthetic tests сохраняют покрытие нескольких, неполных и конфликтующих
групп, unique exact match и ambiguity.

Финальный regression: 417 tests passed, 0 failed, 0 skipped; lint, typecheck,
Next.js build, PostgreSQL 17 fresh/upgrade/restore и Android `lintDebug assembleDebug`
прошли. Bridge: versionName `0.21`, versionCode `21`; APK собран локально.
POS software готов к hardware acceptance. Дальнейшая software-разработка POS
остановлена; следующий этап — controlled physical test с отдельным разрешением
владельца на оплату.
