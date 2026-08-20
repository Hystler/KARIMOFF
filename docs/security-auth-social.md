# KARIMOFF: security, admin auth and social login

## Admin authentication

Legacy owner login does not accept `ADMIN_PASSWORD` or any default PIN. The supported owner credential is:

- `ADMIN_PHONE`;
- `ADMIN_PASSWORD_HASH`, a bcrypt hash with cost 12;
- optional `ADMIN_TOTP_SECRET`.

Staff passwords in `staff_users.password_hash` are also bcrypt. Legacy scrypt hashes are upgraded to bcrypt after a successful login. Login rotates the database-backed session. Admin cookies are `HttpOnly`, `Secure` in production and `SameSite=Strict`; customer cookies are `HttpOnly`, `Secure` in production and `SameSite=Lax`.

Failed logins are audited without passwords and protected by a database rate limiter with temporary lockout. Password rotation invalidates legacy owner sessions because the session actor fingerprint contains the active password hash.

`APP_ORIGIN` must contain the public HTTPS origin without a path. It keeps same-origin auth behavior correct behind Timeweb App Platform.

### Safe owner password reset

Generate a temporary credential outside the repository:

```bash
npm run admin:credential:generate -- --output=/secure/path/KARIMOFF-admin-reset.env
```

The generated file has mode `0600`. Put only `ADMIN_PASSWORD_HASH` into the target environment, redeploy, verify login and transfer the temporary password through a separate secure channel. Never add the file to Git.

## Telegram Login

Telegram remains the primary social login. The official Telegram Login JavaScript Library opens the provider flow from the KARIMOFF page with Russian UI, `profile`, `phone` and `write` scopes. The browser sends only the returned ID token and an opaque attempt ID to the server.

The server validates the one-time attempt, nonce, RS256 signature from Telegram JWKS, issuer, audience, expiration and issued-at time. The stable identity key is Telegram `sub`. Provider tokens are neither logged nor persisted. A missing verified phone continues through the KARIMOFF SMS confirmation flow.

Environment:

- `TELEGRAM_OIDC_CLIENT_ID`.

The existing Telegram client secret may remain server-side for compatibility, but the JavaScript Login Library never receives it.

## MAX Login

MAX does not use a fabricated OAuth or OIDC flow. KARIMOFF uses the officially documented MAX chatbot + Mini App architecture. The original browser creates a one-time login challenge and opens:

`https://max.ru/<MAX_BOT_NAME>?startapp=<opaque_challenge>`

The Mini App at `/integrations/max/app` receives `window.WebApp.initData` from MAX Bridge. KARIMOFF validates raw `WebAppData` on the server with the official two-stage HMAC algorithm, checks freshness and binds `start_param` to the stored challenge. `initDataUnsafe` is never trusted.

For a new identity, the Mini App asks for the phone only after an explicit user action through `window.WebApp.requestContact()`. Its separate HMAC, timestamp, MAX user ID and normalized phone are validated server-side. Refusal sends the user to the existing KARIMOFF SMS completion flow instead of failing the login.

The original KARIMOFF tab polls only the opaque attempt ID. After MAX completes the challenge, that same browser atomically consumes it, creates an ordinary KARIMOFF session, verifies session readback and redirects to the sanitized local `returnTo`. No session value is ever passed through a MAX URL. Automatic switching from MAX back to Safari or Chrome is not required.

Environment:

- `MAX_BOT_TOKEN` — server-only;
- `MAX_BOT_NAME` — bot name used in the `max.ru` launch URL;
- `MAX_MINI_APP_URL` — public HTTPS URL ending in `/integrations/max/app`.

See [MAX integration architecture](./max-auth-integration.md).

## Login UX and redirects

- The login order is Telegram, MAX, `или`, phone/password, SMS.
- A provider button is rendered only when that provider is fully configured.
- Attempts retain a sanitized relative `returnTo`; absolute and protocol-relative redirects fall back to `/profile`.
- The MAX origin tab remains the login coordinator and resumes a pending attempt after refresh or returning from the app.
- Provider errors are converted to Russian user-facing messages. Tokens and raw signed payloads are never shown.
- Display name, username and avatar never trigger account merging.

## Identity linking rules

- `(provider, provider_user_id)` is globally unique.
- One customer can have at most one identity per provider.
- Telegram and MAX identities are displayed in the profile and admin customer views.
- A verified MAX phone links automatically only to a KARIMOFF customer whose matching phone is already verified.
- A new verified MAX phone can create a new customer.
- Missing phone and legacy unverified phone ownership require the KARIMOFF SMS confirmation flow.
- Linking from an authenticated profile always targets the current customer and fails if the provider identity belongs to someone else.
- The final usable authentication method cannot be unlinked.

## VK retirement

VK ID is removed from the social-auth runtime: there is no login button, client, callback route or required VK environment variable. The universal identity schema still accepts historical `provider='vk'` rows so existing data is not destroyed. Historical VK identities are hidden from active login, profile and admin authentication views and cannot create new login attempts.

## Data and privacy

`user_identities` stores the provider subject, minimal permitted profile fields and linking timestamps. `max_login_challenges`, `oauth_login_attempts` and `pending_social_identities` are short-lived operational records. MAX raw `WebAppData`, contact payloads, bot tokens and Telegram tokens are not stored in identities.

Privacy and personal-data consent documents disclose Telegram and MAX sign-in data. Marketing consent remains separate and social login never subscribes a customer to marketing automatically.
