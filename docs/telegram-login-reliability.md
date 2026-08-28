# Telegram Login reliability

## Current web flow

KARIMOFF uses the official Telegram Login JavaScript Library, not a manual redirect-based OIDC callback. The page calls `Telegram.Login.auth()` with `lang=ru`, the `profile`, `phone` and `write` scopes, and a server-generated nonce. The returned ID token is accepted only after server-side RS256, issuer, audience, expiry, issued-at and nonce validation against Telegram JWKS.

The library flow returns an ID token directly and does not run an Authorization Code exchange. Therefore PKCE is not part of this runtime path. The existing encrypted verifier column remains in the generic short-lived attempt schema for compatibility; it is never exposed to the browser or presented as an active PKCE exchange.

Official reference: <https://core.telegram.org/bots/telegram-login>.

## Provider verification and browser session

The flow deliberately separates two operations:

1. The Telegram library returns an ID token to the KARIMOFF page.
2. `/api/auth/social/telegram/library/complete` validates it and atomically changes the server attempt from `pending` through `provider_verified` to `completed`.
3. Validated minimal claims are encrypted at rest in the short-lived attempt. The ID token itself is not stored.
4. `GET /api/auth/social/telegram/status` is read-only and returns only `pending`, `completed`, `expired` or `failed`.
5. A hidden page never consumes an attempt. On `pageshow`, `focus`, `online` or `visibilitychange` to visible, the original page immediately checks status.
6. Only the active, browser-bound origin page calls `POST /api/auth/social/telegram/consume`.
7. Consume resolves or links the identity, creates the ordinary KARIMOFF customer session, reads it back, and stores the exact resolved customer reference with the prepared result.
8. `/api/auth/social/telegram/client-complete` proves that the same customer session or matching SMS continuation cookie is readable. Only then does it mark the attempt browser-consumed, remove encrypted transient claims and clear the attempt cookie.
9. The client redirects only to the sanitized local `returnTo`.

The attempt cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, scoped to `/`, and has no custom Domain. The customer session uses the same browser-compatible cookie policy. A processing lease, persisted completion result and resolved-customer check make duplicate consume calls idempotent without accepting an unrelated stale browser session.

## iPhone and Android behavior

Correctness does not depend on Telegram or the operating system automatically switching back to Safari or Chrome. The user may return manually after confirmation. The original KARIMOFF page keeps the opaque attempt reference in session storage, while the authoritative binding remains in the HttpOnly cookie. Browser resume events trigger an immediate status check and active-browser consume.

The popup communication required by Telegram remains enabled only on login-capable pages through `Cross-Origin-Opener-Policy: same-origin-allow-popups`, as required by the official Login Library documentation.

Those CSP and COOP headers are document-level policies. Public links into `/login`, `/register` and `/profile` therefore use full document navigation instead of a soft App Router transition; otherwise the destination would inherit the stricter policy of the page where navigation began and the official Telegram script would be blocked until refresh. Ordinary public pages keep `script-src 'self'` and `Cross-Origin-Opener-Policy: same-origin`.

## Identity and phone

The stable key is `(provider='telegram', provider_user_id=sub)`.

- An existing Telegram identity signs in without requesting or requiring a phone again.
- A new identity with a verified Russian phone may safely link to the matching verified KARIMOFF customer or create a customer.
- A new identity without a usable verified phone proceeds to the existing KARIMOFF SMS completion screen.
- Name, username and avatar are never used to merge accounts.

## Bot confirmation message

The `write` scope asks the user for permission for the bot to message them. Telegram documents this permission in the Login Library, and the Bot API supports `sendMessage` with an inline URL button. This makes a transactional confirmation such as “Вход в KARIMOFF подтверждён” technically possible for `@Karimoff_food_bot` after consent.

KARIMOFF does not send that message in this release. Sending requires a separate server-only Bot API token, delivery retry/outbox handling and an explicit transactional notification policy. The OIDC client secret is not a Bot API token. No token, attempt reference or session secret should ever be placed in the return button URL.

Official references: <https://core.telegram.org/bots/telegram-login> and <https://core.telegram.org/bots/api#sendmessage>.

## Telegram Mini App foundation

Telegram officially supports Mini Apps opened from a bot profile, menu button, keyboard or direct link. A future KARIMOFF Mini App can host menu, cart, order status, loyalty and profile flows. Its raw `Telegram.WebApp.initData` must be validated on the server before any identity or order operation.

This release does not move login into a Mini App. The current Login Library already provides validated social login, while a Mini App is a separate product surface that needs its own launch configuration, signed init-data validation, order permissions and UI acceptance testing.

Official reference: <https://core.telegram.org/bots/webapps>.

## Migration and observability

Migration `20260824120000_add_telegram_browser_consume.sql` adds only lifecycle fields, a nullable resolved-customer reference, constraints and an index to `oauth_login_attempts`. It does not change customers, identities, orders or other business data.

Safe correlation stages contain no token, full phone, cookie or personal profile data:

- `telegram.login.started`
- `telegram.provider.verified`
- `telegram.challenge.completed`
- `telegram.browser.resume`
- `telegram.browser.status.completed`
- `telegram.browser.consume`
- `telegram.session.created`
- `telegram.session.readback.ok`
- `telegram.redirect.success`
