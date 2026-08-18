# KARIMOFF: security, admin auth and social login

## Admin authentication

Legacy owner login no longer accepts `ADMIN_PASSWORD` or any default PIN. The only supported owner credential is:

- `ADMIN_PHONE`;
- `ADMIN_PASSWORD_HASH`, a bcrypt hash with cost 12;
- optional `ADMIN_TOTP_SECRET`.

Staff passwords in `staff_users.password_hash` are also bcrypt. Existing legacy scrypt hashes remain readable for one login and are then rehashed to bcrypt automatically. Successful login rotates the database-backed session. Admin cookies are `HttpOnly`, `Secure` in production and `SameSite=Strict`; customer cookies are `HttpOnly`, `Secure` in production and `SameSite=Lax` for OAuth redirects.

Failed logins are stored without passwords and use a database rate limit with exponential temporary lockout. Password rotation invalidates legacy owner sessions because the session actor fingerprint includes the active password hash.

### Safe owner password reset

Generate a new temporary credential outside the repository:

```bash
npm run admin:credential:generate -- --output=/secure/path/KARIMOFF-admin-reset.env
```

The file is created with mode `0600` and contains a random temporary password plus its bcrypt hash. Put only `ADMIN_PASSWORD_HASH` into the target Timeweb environment, redeploy, verify login, then deliver the temporary password through a separate secure channel. Never add the generated file to Git.

## Telegram Login

KARIMOFF uses Telegram OIDC Authorization Code Flow with PKCE S256. The server stores a one-time, expiring state record; the PKCE verifier and nonce are encrypted with a key derived from `SESSION_SECRET`. The callback validates the state cookie, one-time database state, RS256 signature from Telegram JWKS, issuer, audience, expiration, issued-at time and nonce. The stable identity key is OIDC `sub`. Access and ID tokens are not persisted.

Environment variables:

- `TELEGRAM_OIDC_CLIENT_ID`
- `TELEGRAM_OIDC_CLIENT_SECRET`
- `TELEGRAM_OIDC_REDIRECT_URI`

Test callback:

`https://hystler-karimoff-stand-ad9d.twc1.net/api/auth/social/telegram/callback`

Future production callback:

`https://karimoff.site/api/auth/social/telegram/callback`

Keep the Telegram signing algorithm at the default RS256. The default scope is `openid profile`. Phone scope is disabled unless `SOCIAL_AUTH_REQUEST_PHONE=true` is explicitly configured.

## VK ID

KARIMOFF uses VK ID OAuth 2.1 Authorization Code Flow with PKCE S256 and one-time state. The callback additionally requires the VK `device_id`. The authorization code is exchanged server-side and the profile is requested from the official `user_info` endpoint. Tokens are used only inside the callback and are not persisted.

Environment variables:

- `VK_ID_CLIENT_ID`
- `VK_ID_REDIRECT_URI`

The current official VK ID web PKCE flow does not use a protected client secret. Do not invent or commit one.

Test callback:

`https://hystler-karimoff-stand-ad9d.twc1.net/api/auth/social/vk/callback`

Future production callback:

`https://karimoff.site/api/auth/social/vk/callback`

VK phone data is never treated as verified automatically because the consumed response has no explicit verification claim. A user must confirm the number through the KARIMOFF SMS flow before a VK identity can be merged with an existing phone profile.

## Identity linking rules

- `(provider, provider_user_id)` is globally unique.
- One customer can have at most one identity per provider.
- Display name, username, avatar and email never trigger automatic linking.
- A provider phone can trigger automatic linking only when the provider explicitly marks it verified and the existing KARIMOFF phone is also verified.
- Otherwise, KARIMOFF requires an SMS confirmation before creating or merging a profile.
- Linking from an authenticated profile always targets the current customer and fails if the provider identity belongs to another customer.
- The last available authentication method cannot be unlinked.
- Provider access and refresh tokens are not stored.

## Data and privacy

`user_identities` stores only the provider subject, minimal profile fields and linking timestamps. `oauth_login_attempts` and `pending_social_identities` contain short-lived one-time records and no provider tokens. Privacy and personal-data consent documents use legal version `2026-08-18.v2` and disclose Telegram/VK authentication claims.

## Provider setup

1. In BotFather open the KARIMOFF bot, configure Web Login / Allowed URLs for the test domain, keep RS256, add the Telegram test callback, and copy the issued Client ID and Client Secret into the test stand environment.
2. In the VK ID cabinet create or open the KARIMOFF web application, add the VK test callback to trusted redirect URLs, and copy the application ID into `VK_ID_CLIENT_ID`.

Real provider login remains hidden until all required variables for that provider are present. Automated tests use signed local fixtures and mocked VK responses; they do not imitate a successful real OAuth login on the stand.
