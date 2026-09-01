# Карта гостя и аналитика аудитории

## Что реализовано

У авторизованного гостя есть персональная страница `/profile/loyalty` с балансом, номером карты и QR. QR содержит подписанный одноразово ротируемый идентификатор карты, а не телефон или `customer_id`. Сам QR только находит гостя на POS: списание баллов по нему невозможно.

Кассир сканирует QR перед оплатой. POS связывает canonical order с существующим `customer_id`, поэтому заказ, начисления и история гостя используют тот же order flow. Склад, KDS и списание ингредиентов не дублируются.

В `/admin/analytics/audience` показаны только измеримые признаки:

- доля продаж, связанных с гостем;
- новые, возвращающиеся, постоянные, уходящие и спящие гости;
- частота и давность заказов;
- фактическая выручка и средний чек сегмента;
- предпочтения по товарам;
- способы входа и маркетинговый охват;
- покрытие картой гостя.

Возраст показывается только при достаточном заполнении и размере групп. Пол, доход и интересы KARIMOFF не выводит, потому что таких достоверных данных нет.

## Apple Wallet

Apple Wallet pass является подписанным пакетом. Нужны Pass Type ID, Pass Type ID certificate, закрытый ключ и актуальный WWDR intermediate certificate. После заполнения server-only env появляется кнопка Apple Wallet. Без сертификатов приложение оставляет рабочий QR и не показывает ложную кнопку.

Текущая версия pass статическая: баланс соответствует моменту добавления. Для автоматического обновления баланса следующим этапом нужен официальный PassKit web service и APNs update flow.

Официальные разделы:

- [Building a Pass](https://developer.apple.com/documentation/walletpasses/building-a-pass)
- [Creating a Generic Pass](https://developer.apple.com/documentation/walletpasses/creating-a-generic-pass)
- [Distributing and Updating a Pass](https://developer.apple.com/documentation/walletpasses/distributing-and-updating-a-pass)

## Google Wallet

Нужны Google Wallet issuer account, Google Cloud service account и опубликованный loyalty class. Сайт формирует короткоживущий RS256 Save to Google Wallet JWT server-side; private key не попадает в браузер.

Официальные разделы:

- [Loyalty cards for Web](https://developers.google.com/wallet/retail/loyalty-cards/web)
- [Issuer onboarding](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/issuer-onboarding)
- [REST authentication](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/auth/rest)

## Telegram и MAX

Текущий login flow не меняется. Карта доступна на адаптивной web-странице после обычной авторизации. Следующий этап может открыть тот же loyalty/profile experience как Telegram Mini App и MAX Mini App.

Telegram требует server-side validation `Telegram.WebApp.initData`. MAX Mini App запускается через бота и требует server-side validation WebAppData. Нельзя доверять unsafe client data или передавать customer/session secrets в launch URL.

- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- [MAX Mini Apps](https://dev.max.ru/docs/webapps/introduction)
- [MAX Bridge](https://dev.max.ru/docs/webapps/bridge)

## Миграция и безопасность

`20260901170000_add_loyalty_cards_and_audience.sql` добавляет `loyalty_cards` и customer-aware overload существующего POS RPC. Миграция additive, сохраняет старую сигнатуру POS, включает RLS, grants и уникальности по гостю и публичному номеру карты.

Подпись QR выводится из `SESSION_SECRET` с отдельной purpose string. Перевыпуск увеличивает `token_version`, поэтому старый QR немедленно перестаёт разрешаться. В QR нет телефона, баланса и session token.

## Полезные следующие метрики

После накопления истории стоит добавить cohort retention 7/30/60/90 дней, средний интервал между заказами, реактивацию после кампаний и изменение частоты до/после акции. Для attribution понадобится явный `acquisition_source` при первом входе; подменять его UTM последнего визита нельзя.
