# Первый UI/polish pass

Кодовый аудит и визуальная проверка выполнены на отдельной ветке `codex/frontend-design`. Скриншоты сняты с одинаковым viewport для каждой пары.

## Ключевые сравнения

| Поверхность | До | После |
| --- | --- | --- |
| Главная, mobile/header | [до 390](screenshots/before-home-390.png) | [после 390](screenshots/after-home-390.png) |
| Главная, desktop | [до 1440](screenshots/before-home-1440.png) | [после 1440, 4 колонки](screenshots/after-home-1440-4col.png) |
| Каталог, mobile | [до 390](screenshots/before-menu-390.png) | [после 390](screenshots/after-menu-390.png) |
| Каталог, desktop | [до 1440](screenshots/before-menu-1440.png) | [после 1440](screenshots/after-menu-1440.png) |
| Товар, mobile | [до 390](screenshots/before-product-390.png) | [после 390](screenshots/after-product-rokki-390.png) |
| Товар, desktop | [до 1440](screenshots/before-product-1440.png) | [после 1440](screenshots/after-product-rokki-1440.png) |
| Товар с длинными modifiers | — | [390, итог 1 530 ₽ и sticky CTA](screenshots/after-product-modifiers-390.png) |
| Social login | [до 390](screenshots/before-social-login-390.png) | [после 390](screenshots/after-social-login-390.png) |
| Общая 404 | [до 390](screenshots/before-404-390.png) | [после 390](screenshots/after-general-404-clean-390.png) |
| Cart/cookie | [до 390](screenshots/before-cookie-cart-390.png) | [после 390](screenshots/after-cookie-cart-390.png) |

На локальном окружении auth провайдеры отображают сообщение о временной недоступности, поэтому после-скрин фиксирует доступное состояние. Telegram и MAX provider colors не менялись.

## Главная: 4 против 5 колонок

Скриншоты показывают варианты на 1440 и 1920 px при действующем customer max-width 1280 px: [1440 / 4](screenshots/after-home-1440-4col.png), [1440 / 5](screenshots/after-home-1440-5col.png), [1920 / 4](screenshots/after-home-1920-4col.png), [1920 / 5](screenshots/after-home-1920-5col.png). При пяти колонках ширина карточки сокращает текстовые строки; ширина самого контейнера на 1920 не растёт. Рекомендация — оставить текущие 4 колонки.

## Mobile category rail

Аккуратный крайний fade проверен на [390](screenshots/after-menu-categories-390.png), [430](screenshots/after-menu-categories-430.png) и [768](screenshots/after-menu-categories-768.png). На 430 подсказка скрывается, когда все категории видны; на 768 категории переносятся и горизонтальная прокрутка не нужна.

Подробная шкала и сохранённые content-specific размеры: [spacing-system-v1.md](spacing-system-v1.md).
