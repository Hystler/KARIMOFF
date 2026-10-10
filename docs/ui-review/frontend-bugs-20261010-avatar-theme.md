# Аватары, тема и мобильная франшиза — 10 октября 2026

База: актуальный main `89d1002`, ветка `codex/frontend-menu-profile-fixes-20261010`.

## Аватары

Существующие части изучены: `AvatarPreview.tsx` уже рисует 2D-панду и поддерживает прежние `panda_round`, `panda_strict`, `serious`, `orange_apron`, `burger_pin`, старые фоны и новые значения. Использован этот рисунок; логотип не менялся, новые изображения не генерировались.

`AvatarBuilder` заменён на десять готовых сочетаний из `avatar-presets.ts`: Классик, Шеф, Меломан, Солнечный, Спокойный, Уверенный, Улыбка, Ночной, В команде, На чиле. Сетка использует нативные radio inputs с поддержкой Tab/стрелок и видимым focus. Отдельный вариант «Ваш сохранённый образ» отображается, если старый аватар не совпадает с пресетом; без явного выбора новой панды сохраняется исходная конфигурация.

Сохранение использует существующие поля `base/eyes/mouth/accessory/clothes/background`, прежний `avatarSchema`, авторизованный `saveAvatarAction` и `customer_avatars.upsert`. SQL-ограничений enum нет; миграция не требуется. Страница больше не запрашивает ненужные asset lists, клиентский builder не загружает `Avatar3DStudio` и Three.js. Старый исходник студии оставлен для истории/совместимости; пакет three не удалён в рамках этой задачи.

## Тема

В текущем main manual preference уже хранится в `karimoff_theme_preference_v2`, bootstrap применяет её до paint, общий ThemeProvider используется public/admin/operational. Принудительной темы для профиля нет. Цвета профиля уже имеют отдельные dark/light tokens.

Найден runtime дефект: запрет localStorage в браузере выбрасывал необработанную ошибку при hydration и нажатии переключателя. Read/write теперь защищены; выбор действует в текущей вкладке даже при запрете хранения. Синхронизация `storage` обновляет тему других вкладок и возвращает следование системе при удалении preference. Никакая новая preference key или новая палитра не вводилась.

Локальные contrast-тесты всех существующих profile foreground/surface/state пар проходят в обеих темах. **Это не заменяет визуальную проверку каждого маршрута в браузере.** Chrome DevTools connector возвращает `browser is already running`; доступен CUA как fallback. Сохранение и production authentication не проверялись через fixture.

Отдельно отмечен существующий риск QR: глобальная dark override `.bg-white` затемняет QR quiet zone; передано агенту личного кабинета для исправления на странице карты.

## Франшиза

Hero, фотографии, тексты, порядок блоков и заявки сохранены. Только на мобильном экране уменьшены расстояния между секциями/абзацами, padding панелей и карточек преимуществ. Текст остаётся 16px, основной leading 24px вместо 32px; более плотные списки преимуществ остаются 14px. `sm:` сохраняет прежнюю desktop плотность. Бизнес/карьера не менялись. Форму заявки не отправляли.

## Проверки

- `node --test tests/avatar-studio.test.mjs tests/theme-preference.test.mjs tests/profile-theme.test.mjs`: 14 passed, 0 failed.
- Runtime tests: десять уникальных конфигураций round-trip через прежнюю схему; legacy конфигурация сохранена без потери полей; theme storage read/write denial; manual preference priority; sync/reset между вкладками.
- Targeted ESLint own TS/TSX/tests: passed.
- `git diff --check`: passed.
- Полные lint/typecheck/build и браузерный QA выполняются после объединения текущих параллельных изменений в worktree.
- Production DB/env не читались и не менялись для этой подзадачи; real account/avatar writes не выполнялись.

## Disposable authenticated browser fixture

После отдельной read-only проверки установлено: прежний Docker daemon отсутствовал, старые audit `ready.json` не описывали живые БД, локальный PostgreSQL не слушал. Создан **новый** Colima profile `karimoff-ui-qa-20261010`, без mounts и без переключения default Docker context; прежний default profile не запускался.

- Новый контейнер: `karimoff-ui-qa-pg-20261010`, PostgreSQL 17.11.
- Подтверждён actual host binding `127.0.0.1:55449` (Docker inspect + lsof).
- Новая БД: `karimoff_ui_qa_20261010_1791639446322`, 35 существующих migrations + existing catalog seed.
- Runtime `karimoff_app`: `rolsuper/rolcreatedb/rolcreaterole/rolbypassrls = false`.
- Fixtures: один synthetic customer, один synthetic owner, два настоящих HMAC `app_sessions`, legacy avatar, synthetic loyalty account/consent, synthetic `local-required-selection` product с обязательным min=1 modifier.
- На момент setup: **0 orders, 0 payments**. Fixture цены/consent не являются production данными или согласием реального человека.
- Secrets/session tokens сохранены только в `/tmp/karimoff-ui-qa-20261010/private.json` с permissions 0600; в отчёты/чат не выводятся.
- Отдельный runner `/tmp/karimoff-ui-qa-20261010/run.mjs` использует app port 3121 и localhost fixture proxy 3122; общий root server 3120 не трогает. Все provider flags выключены, external fetch заблокирован existing `rc-mock-network.mjs`, migrations read-only.
- Proxy fixture sign-in устанавливает только cookies синтетических sessions и возвращает к приложению. Приложение продолжает проверять токен, expires/revoked, active staff/role через неизменённые customer/staff auth guards. Это локальная проверка UI и server authorization integration; она не подтверждает корректность production сессий/credential configuration.

### Actual local persistence smoke

На запущенном отдельном fixture runtime выполнены реальные серверные проверки:

- Synthetic necessary-only cookie consent POST через proxy3122 с same-origin: HTTP 200, `{ok:true, stored:true}`.
- Авторизованный GET `/profile/avatar` через настоящую synthetic customer session возвращает форму с actual server action ID.
- Multipart POST этой существующей server action: HTTP 303 `/profile?avatar=saved`; SQL readback подтверждает все шесть выбранных полей аватара. После проверки исходный legacy fixture avatar восстановлен, чтобы визуальный QA мог проверить compatibility state.
- Изменялись только записи новой disposable БД. Production UI/auth/данные не использовались.

Таким образом, origin/proxy/runtime grants не блокируют cookie и avatar persistence. Browser UI click ещё требует отдельного визуального подтверждения; tab принадлежит основной QA-сессии.

### Long customizer fixture и найденный consent reader bug

Для локального long-modal QA синтетический `local-required-selection` расширен шестью recipe lines (removable + extra available, max 3) и optional multi group из шести вариантов (min 0/max 3). Существующие базовая цена 250, required group min 1 и его option не менялись. GET `/menu` подтверждает фактическую загрузку всех новых ingredients/options. Script только для данной loopback disposable БД: `/tmp/karimoff-ui-qa-20261010/extend-product.mjs`.

На `/profile/loyalty` обнаружен реальный reader defect: seed consent имеет правильные subject/type/granted/current LEGAL_VERSION, но `getCurrentConsentState` вызывает `.or("granted.eq.true,source_path.neq./checkout")`. PostgreSQL adapter поддерживал только `eq` в OR, поэтому возвращал error вместо consent; caller молча получал null и показывал consent gate. Это не проблема fixture seed. Причина передана основному/profile агентам для минимального исправления adapter/query и теста; данный агент shared adapter не менял.

### Home first-four fixture normalization

Для финального browser QA только disposable fixture catalog приведён к отдельно подтверждённым public product values: `shaurma-kurinaya` (260), `tayson` (430), `chicken-roll` (280), `shaurma-v-lepeshke-govyadina` (460). У говяжьей шаурмы переименован старый seed slug с сохранением existing image; отсутствующий в старом seed `chicken-roll` использует существующий public import image/copy. Actual server-rendered home h3 подтверждает именно этот порядок. Script: `/tmp/karimoff-ui-qa-20261010/normalize-home-four.mjs`. Это синтетическое воспроизведение каталога для UI QA, не аналитика продаж, не production migration.

### Proxy read-only checkout action allowlist

Финальный checkout UI запрашивает `getCheckoutContextAction` через POST; прежний общий `/checkout` guard блокировал этот read-only запрос. Исправлен **только временный** `/tmp/karimoff-ui-qa-20261010/run.mjs`:

- built action ID берётся по exact `exportedName` из текущего server-reference manifest;
- разрешён исключительно `/checkout`, exact `Next-Action` ID контекста, `text/plain`, body `[]`;
- legitimate cookie consent и exact avatar action остаются доступны;
- остальные POST запрещены по умолчанию, включая order/payment/fiscal mutations на других paths и поддельные form action IDs.

Actual smoke: context 200; context на `/menu`, с аргументами, либо JSON content type — 403; `createOrderAction` на `/checkout` и `/menu`, а также в forged avatar form — 403; legitimate avatar save — 303. Before/after orders/payments counts одинаковы (один отдельно посеянный historical fixture order, ноль payments). App code/build/root3120 не менялись.
