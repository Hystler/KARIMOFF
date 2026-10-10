# KARIMOFF: frontend и исправления — 10 октября 2026

## База и ограничения

- Репозиторий: `Hystler/KARIMOFF`, origin `https://github.com/Hystler/KARIMOFF.git`.
- База: проверенный актуальный `origin/main`, `89d10027ab039d354986506f959f0274fe4d258e`.
- Ветка: `codex/frontend-menu-profile-fixes-20261010`; отдельный worktree. Исходный checkout с несвязанными изменениями не тронут.
- Production: только ограниченные SELECT в READ ONLY transaction с ROLLBACK. DB/env, цены, mappings, заказы и платежи не менялись. Merge/deploy/push не выполнялись.
- Браузерные изменяющие проверки выполнены только на новой disposable PostgreSQL 17.11 БД, localhost:55449. Подписанные synthetic customer/owner sessions проходят прежние guards. Это не доказательство production-авторизации.

## Что исправлено

1. Карточки: двухстрочный фиксированный слот заголовка, согласованное выравнивание цены, одинаковая структура/высота ряда; семантический h3 с отдельной кнопкой названия. Две мобильные колонки сохранены.
2. Главная: точная первая четвёрка по подтверждённым active slugs; остальной полный каталог сохранён. Это заданный владельцем порядок, не выдуманный рейтинг продаж.
3. Основное действие — «В корзину», рядом отдельная touch-кнопка настройки. Допустимая базовая конфигурация добавляется сразу; обязательный незаполненный выбор открывает настройку.
4. Настройка — native modal dialog внутри меню. Перехода/перезагрузки нет, меню сохраняет scroll, состояние настройки остаётся при повторном открытии. Фото 80px, компактные группы/строки, внутренний scroll, CTA 48px с safe-area. Detail route и полноценная страница товара остаются рабочими.
5. Хот-доги: отдельный public filter; из снэков исключены. В production и admin они уже имеют собственную категорию `Хот-Доги`; данные менять не потребовалось.
6. Повтор заказа: authenticated read-only endpoint сначала проверяет ownership, читает текущие доступные товары/цены/options. Корзина заменяется атомарно, modifiers/количество/заметка восстанавливаются без угадывания legacy grams. Историческая доставка не становится товаром. Недоступные/изменившиеся позиции явно перечислены; согласованный fallback — checkout доступных позиций. Ошибка чтения оставляет прежнюю корзину.
7. QR: компактная шапка, QR первым на mobile, белая quiet zone в обеих темах. Дополнительно исправлен реальный reader bug: OR adapter не поддерживал `neq`, из-за чего действующее consent ошибочно считалось отсутствующим. Проверка согласия не отключена.
8. Тема: guarded storage, ручной выбор сохраняется, синхронизируется между вкладками; при запрете storage переключение остаётся доступным.
9. Безопасность профиля: существующие узнаваемые Telegram/MAX marks вместо букв, provider blue/purple сохранены.
10. Аватар: десять готовых 2D-панд на основе существующего рисунка; native radio выбор, прежняя схема сохранения. Старый avatar остаётся отдельным вариантом до выбора нового. 3D studio больше не импортируется страницей выбора.
11. Франшиза: уменьшены mobile отступы/интервалы ниже hero; desktop, hero, бизнес и карьера сохранены.
12. Обзор: выручка за сегодня из canonical analytics с прежним scope и московским периодом, включая Evotor. Ошибка загрузки показывает «—», а не ложный ноль. Active/kitchen учитывают прежние operational states.
13. Food-cost coverage: покрытый абсолютный оборот делится на общий абсолютный оборот. Costed returns больше не уменьшают coverage полностью рассчитанных продаж. Signed revenue/profit не менялись.

## Реальные данные, не fixture-статистика

Read-only снимок 10 октября, около 13:35 UTC; период 11 сентября–10 октября, Москва:

| Товар каталога | Slug | Текущая цена | Продажи за 30 дней |
|---|---|---:|---|
| Шаурма с курицей | shaurma-kurinaya | 260 ₽ | 2 202 ед., 564 523,35 ₽ |
| Тайсон | tayson | 430 ₽ | 120 ед., 51 535,50 ₽ |
| Чикенролл | chicken-roll | 280 ₽ | Exact mapped SKU: 0; raw «Чикен ролл»: 19 ед., 5 250 ₽, unmapped |
| Шаурма с говядиной в лепёшке | shaurma-v-lepeshke-govyadina | 460 ₽ | 62 ед., 28 428 ₽ |

- Сегодня canonical Evotor: 62 продажи / 35 950 ₽. Прежний native-orders-only dashboard не видел этот источник — причина нулевой выручки подтверждена.
- Реальных текущих active/cooking operational orders в снимке нет. Нули очереди/кухни не подменены искусственными числами.
- Food cost 30d: 4 622 строки, 3 574 покрыты, оборот 1 631 886,50 ₽, непокрыто 227 559,37 ₽. Покрытие **86,0554%**, старая и исправленная формулы здесь совпадают. Поэтому программная ошибка refunds не объявляется причиной пользовательских 96%.
- 26 групп пробелов. Полный перечень и подтверждённые причины перечислены в [admin report](frontend-bugs-20261010-admin.md). У шести snack-позиций отсутствует однозначная историческая порция; есть unmapped кассовые позиции и одна web-позиция с invalid snapshot. Некорректных активных базовых рецептур в этой выборке: 0. Закупочные цены/исторические размеры не придуманы. Повторное чтение полного перечня застало ещё одну рассчитанную продажу: 4 623/3 575 строки, оборот 1 632 666,50 ₽, те же непокрытые 227 559,37 ₽, покрытие 86,0621% обеими формулами.

## Что не воспроизведено / вопросы

- Повторный production-вход owner/admin при navigation: не воспроизведён. Cookie path/единые session guards/роль проверены; local owner прошёл admin → POS → kitchen без login. Auth/security не переписывались. Нужны конкретный маршрут, домен и момент повторного входа в реальной сессии.
- 96% coverage: не воспроизведено за проверенный период; запрошены исходные период/точка/источник/скриншот.
- Historical portion/mapping gaps требуют подтверждённых кассовых названий/размеров. Production data fixes не выполнялись.
- Legacy дополнительные ингредиенты без serving-count snapshot явно требуют нового выбора: исторические граммы нельзя безопасно преобразовать сегодняшними размерами.

## Проверки

- `npm test`: **522 total, 478 passed, 0 failed, 44 skipped**. Skip имеют явные причины: отсутствующие специализированные disposable PG/RC/payment/integration DSN. Они не объявляются пройденными; UI regressions не обнаружены.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed (production Next build).
- `git diff --check`: passed.
- React/code review: lazy mounting customizers до первого открытия, hooks/cleanup, native focus/inert/Escape, валидная heading semantics; ownership до item reads, parameterized OR whitelist, текущие цены/валидация, атомарная замена и hydration race. Новых dependencies/frameworks нет.
- Actual-schema smoke обнаружил и исправил сортировку по несуществующему `order_items.created_at` и `neq` consent reader; schema-backed повтор заказа и QR проверены локально.
- Browser widths: **320, 360, 390, 430, 520, 768, 1024, 1440**, дополнительно 1920. Проверены фактические `innerWidth`, grid columns и overflow: 2/2/2/2/2/3/3/4/4, overflow отсутствует. Первые четыре карточки одинаковой высоты; mobile primary 46px, settings 44px.
- Long required customizer: disabled CTA до выбора, option +30/ingredient +30 → 310 ₽; add закрывает modal, сохраняет `/menu`, scroll 4208,5px и selections/note. Один active native modal.
- Repeat fixture: прежние позиции удалены; 2 × (250 + 30) = 560 ₽, required option/note восстановлены, unavailable food показан, delivery fee исключён. Reload сохраняет warning. Реальное локальное оформление открылось с pickup и суммой 560 ₽; payment CTA выключена fixture settings. Proxy разрешает только точный built read-only context action без аргументов на /checkout; createOrder/payment POST остаются запрещены, orders=1 historical fixture, payments=0.
- Theme: light сохраняется после navigation; dark/light menu/profile/QR/avatar проверены, legacy selection сохранён. Actual saveAvatarAction local smoke дал 303 и подтвердил 6 полей readback.
- Хот-доги в отдельном rail filter; снэки без хот-догов. POS/KDS local owner identity сохранена, заказ/оплата не создавались.

## Screenshots

Артефакты находятся в worktree: `outputs/frontend-ui-20261010/screenshots/`.

- `home-catalog-390-light.png`: вся согласованная первая четвёрка, выравнивание строк.
- `menu-390-final.png`: mobile dark каталог и два действия.
- `menu-1440-final.png`: реальный viewport 1440 × 900, четыре колонки.
- `customizer-390-required.png`: длинная настройка, обязательный выбор.
- `customizer-390-selected.png`: итоговая цена, компактный scroll и sticky CTA.
- `loyalty-390-dark.png`: QR целиком без прокрутки.
- `avatar-390-dark.png`: ready-made 2D выбор и legacy вариант.
- `profile-390-light.png`, `franchise-390-light.png`: дополнительные visual smoke.
- `repeat-checkout-390.png`: оформление доступных позиций с явным предупреждением и суммой 560 ₽.

Дополнительные подробности: [profile](frontend-bugs-20261010-profile.md), [admin](frontend-bugs-20261010-admin.md), [avatar/theme/franchise](frontend-bugs-20261010-avatar-theme.md).
