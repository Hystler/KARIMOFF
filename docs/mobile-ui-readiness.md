# Подготовка frontend KARIMOFF к будущему mobile app

Этот документ фиксирует, что можно переиспользовать при отдельной разработке приложения на React Native/Expo. Само приложение и перенос компонентов в этой итерации не создаются.

## Уже переносимые основы

- **Семантика бренда:** KARIMOFF Black `#121214`, Orange `#FB670A`, White `#FFFFFF`, Warm Base `#F4F1ED`; тёмный orange для небольшого текста на светлом фоне `#B74700` (WCAG contrast 4.76:1 на Warm Base). Текст на основной оранжевой кнопке — чёрный `#121214` (6.28:1 на `#FB670A`). В тёмной теме семантический orange возвращается к `#FB670A`.
- **Ритм и плотность:** шаги 4, 8, 12, 16, 24, 32, 40, 48, 64, 80 px; customer-поля страницы 20/32/40 px; customer max-width 1280 px. Это значения токенов, а не размеры RN-компонентов.
- **Типографическая роль:** Rubik 900 для выразительных заголовков и числовых акцентов; Manrope для текста и интерфейса. В native нужно отдельно включить и проверить файлы шрифтов, метрики и fallback.
- **Контент:** русские названия действий, статусы, ошибки и пустые состояния можно хранить в общем каталоге копирайта, если текст не зависит от browser/native поведения.
- **Предметные типы:** `src/lib/product-types.ts` и платформенно-нейтральные части `src/lib/order-flow/types.ts` — хорошие кандидаты для общего пакета после проверки зависимостей. `src/lib/order-schema.ts` и другие Zod-схемы можно переиспользовать только там, где одинаковы правила валидации и Zod доступен обеим платформам.
- **Иконки:** сохранять семантические имена действий (`cart`, `minus`, `plus`, `close`), а сами иконки рисовать renderer-ом платформы. Lucide React SVG-компоненты не являются готовыми React Native-компонентами.

## Что останется web-specific

- Next.js маршруты, `<Link>`, DOM, HTML-семантика, Tailwind-классы и CSS custom properties.
- Sticky purchase bar и cookie notice на CSS `position: fixed`, CSS `env(safe-area-inset-*)`, `IntersectionObserver` и управление фокусом DOM.
- `next/image`, браузерные таблицы и charts, scroll containers, hover states, portals и web dialogs. В native для каждого нужен свой layout и взаимодействие.
- Текущие customer, ERP, POS и KDS компоненты: их можно использовать как поведенческие/визуальные спецификации, но нельзя копировать в RN без перепроектирования под native navigation, safe areas, клавиатуру и touch.
- Provider login SDK: Telegram и MAX оставляют свои фирменные цвета; их browser callbacks и web bridge не заменяют native SDK flow.

## Возможный shared package позже

Если появится RN/Expo-проект, вынести проверенные значения в `@karimoff/design-tokens` (JSON или TypeScript source) с генерацией CSS variables/Tailwind theme и native JS theme. Туда же можно добавить роли шрифтов, радиусов 6/8/12 px и уровни поверхностей/теней. Отдельно проверить переносимость типов, Zod-схем и русских текстов в `@karimoff/domain` или `@karimoff/copy`.

Сегодняшний frontend использует эти tokens напрямую через Tailwind config и `src/app/globals.css`; общего package пока нет. Не стоит выделять его до появления второго consumer-а: договорённость о семантике уже описана, а web UI получает от неё пользу сейчас.
