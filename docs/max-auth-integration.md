# KARIMOFF: MAX authentication integration

## Official model

KARIMOFF follows the current MAX platform model rather than inventing OAuth/OIDC:

- a Mini App exists only inside MAX and is attached to a chatbot;
- the website launches the bot with `startapp`;
- MAX Bridge exposes raw `window.WebApp.initData` to the Mini App;
- raw `WebAppData` must be validated server-side;
- `requestContact()` is called only after a user click;
- Bot API requests use `https://platform-api2.max.ru` and the raw bot token in the `Authorization` header.

Official references:

- <https://dev.max.ru/docs/webapps/introduction>
- <https://dev.max.ru/docs/webapps/bridge>
- <https://dev.max.ru/docs/webapps/validation>
- <https://dev.max.ru/docs-api>
- <https://dev.max.ru/docs-api/changelog-api>

## Login sequence

1. The KARIMOFF browser calls `POST /api/auth/social/max/start`.
2. The server creates at least 256 bits of random challenge data and a separate browser binding.
3. PostgreSQL receives only their SHA-256 hashes, a UUID attempt ID, correlation ID, local `returnTo` and a five-minute expiration.
4. The browser opens `https://max.ru/<bot>?startapp=<challenge>` in a separate context and keeps the KARIMOFF page open.
5. MAX opens `https://<stand>/integrations/max/app` inside the bot Mini App.
6. The Mini App sends raw `initData` and the opaque challenge to `POST /api/auth/social/max/complete`.
7. The server verifies the MAX signature, `auth_date`, user payload and exact challenge.
8. An already-linked MAX identity can complete immediately. A new identity asks the user to confirm their phone through `requestContact()`.
9. The server validates the contact signature and timestamp, then marks the challenge completed with an encrypted, minimal identity snapshot.
10. The original browser calls `POST /api/auth/social/max/status`. Only the browser with the bound `HttpOnly` cookie can claim the completed attempt.
11. KARIMOFF resolves or creates the customer, upserts `user_identities`, creates the standard session, performs readback, consumes the challenge and redirects to the safe local `returnTo`.

The flow does not depend on MAX automatically returning the user to Safari or Chrome. When the user returns manually, the original page finishes login without another confirmation.

## WebAppData verification

The server:

1. Rejects an empty or oversized string.
2. Rejects duplicate keys and requires exactly one `hash`.
3. URL-decodes values, sorts keys alphabetically and joins `key=value` pairs with `\n`.
4. Calculates `secret_key = HMAC-SHA256(key='WebAppData', data=BOT_TOKEN)`.
5. Calculates `HMAC-SHA256(key=secret_key, data=launch_params)` and compares hex values in constant time.
6. Accepts `auth_date` for at most one hour with a small future-clock allowance.
7. Validates the signed user ID and only minimal optional profile fields.
8. Requires signed `start_param` to match the one-time challenge.

`initDataUnsafe` is never used as trusted input.

## Contact verification

The Mini App calls `requestContact()` only from the `Подтвердить номер` button. The server builds exactly:

```text
authDate=<value>
phone=<digits without +>
userId=<signed MAX user id>
```

It calculates `HMAC-SHA256(data, MAX_BOT_TOKEN)`, performs constant-time comparison, checks freshness and normalizes supported Russian numbers to E.164. The contact MAX user ID is taken from validated `WebAppData`, not from client input.

If the user refuses, KARIMOFF stores only the validated MAX identity in the existing short-lived pending flow and asks for SMS confirmation on the website.

## Account linking

- Existing `(max, provider_user_id)` signs in its current customer.
- A verified MAX phone can link to the same already-verified KARIMOFF phone.
- A new verified phone creates a customer.
- An unverified local phone owner or missing MAX phone continues by SMS.
- Name, username and avatar are never matching keys.
- A MAX identity owned by another customer is a hard conflict.
- Bot tokens, raw signed payloads and provider access tokens are not stored.

## Database

Migration: `20260820190000_add_max_social_auth.sql`.

`max_login_challenges` contains hashes, state timestamps, browser binding, sanitized redirect and an encrypted short-lived identity snapshot. It has unique challenge/correlation constraints, expiration/status indexes, RLS and explicit runtime-role grants. Expired challenge rows are cleaned opportunistically. Historical VK identity values remain schema-valid but inactive.

## UI and operations

- `/login`: Telegram, MAX, then phone/password and SMS.
- `/integrations/max/app`: branded Russian Mini App with explicit contact consent.
- `/profile`: Phone, Telegram and MAX connection status; the last usable login method cannot be removed.
- `/admin/customers`: provider, MAX ID, username, display name, avatar presence, validated phone status, first link and last login.

The current implementation does not send bot messages. `src/lib/integrations/max/client.ts` is server-only groundwork for future transactional order notifications. Marketing messages are intentionally out of scope.

## Configuration

```dotenv
MAX_BOT_TOKEN=
MAX_BOT_NAME=
MAX_MINI_APP_URL=https://hystler-karimoff-stand-ad9d.twc1.net/integrations/max/app
```

The button stays hidden when any required setting is missing. `MAX_BOT_TOKEN` must never use a `NEXT_PUBLIC_` name.

Since 19 July 2026, MAX requires Bot API traffic through `platform-api2.max.ru` and requires the Ministry of Digital Development certificate in the runtime trust store. Login signature validation itself is local and does not call Bot API; before enabling notification calls, the container trust store must be verified against this requirement.

## Setup in MAX

1. Register at <https://business.max.ru> and create or select a verified Russian organization, IP or self-employed profile.
2. Open `Чат-боты`, create the KARIMOFF bot, provide the required logo, name, description and HTTPS website, then submit it for moderation.
3. After moderation open `Чат-боты` → `Перейти` → `Расширенные настройки` → `Настроить` and obtain the bot token.
4. In the same screen set the Mini App URL to `https://hystler-karimoff-stand-ad9d.twc1.net/integrations/max/app`.
5. Select the Mini App launch button `Открыть` and save.
6. Put `MAX_BOT_TOKEN`, the bot name from its `max.ru/<name>` link, and the exact Mini App URL into the test stand environment.

Do not place real credentials in Git or documentation.
