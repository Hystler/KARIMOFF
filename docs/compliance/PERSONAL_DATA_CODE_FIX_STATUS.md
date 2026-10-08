# Personal-data code-fix status

Reviewed on 2026-10-08 against branch `codex/personal-data-compliance-high-fixes`, based on `origin/main` at `5066af1f1c1d0a3349161c9ad3b81d2c80eb76aa`. This is an implementation review, not a production attestation or legal opinion. No production database/environment was read or changed, no notification was filed, and no deployment was performed.

## Implemented in this branch

- Checkout no longer requires or records personal-data consent for order performance. It presents an order-processing notice with the Privacy Policy. The `Оформить заказ` action is the offer clickwrap; the server records `offer_acceptance` with the current legal version, customer, source, and timestamp in the order transaction.
- Marketing selection is hidden once a current-version choice exists; profile settings can change/revoke it. Repeated identical selections do not add another `legal_consents` row. Checkout records a choice only when no current-version choice exists.
- `/display` sends only public order number, status, and test marker to the client display. It no longer sends customer/order IDs, real name, avatar, or social details.
- Cookie selection is written with its document version and corresponding consent rows in one PostgreSQL transaction. The browser stores/hides the banner only after a successful server response. A failed save remains visible with an error and does not enable optional categories. A material document-version change causes a new choice prompt.
- Generic B2B/other inquiries use the contact request and Privacy Policy notice. Franchise and career forms use their corresponding consent documents. Marketing is saved only on affirmative selection. Reset restores the form's original interest type.
- Lead/candidate creation and purpose-specific franchise/careers evidence now run inside one PostgreSQL function statement and transaction. A consent evidence failure rolls back the corresponding lead. General inquiries do not require that consent.
- Social authentication no longer writes a synthetic personal-data consent. The selected provider/account and phone verification remain separate from the contract basis.
- Social identity storage now retains provider user ID for login/linking/duplicate protection, the verified-phone signal for linking evidence, and only the Telegram Bot recipient ID needed for order-status messages. Provider username/avatar/email and other profile metadata are not stored; display name is used only to initialize the customer profile. Admin/profile identity views no longer fetch or show the removed fields. A forward migration clears old extras while preserving the Telegram notification ID.
- Claim audit: `provider_user_id` is received, uniquely matched on login/linking and required for duplicate protection, so it remains in the backend identity table but is omitted from profile/admin views; `phone` is received where the provider supports verification, used for initial phone-owner matching and retained as the account's primary phone, not duplicated in social rows; `display_name` initializes `customers.name` when needed, but is not retained in `user_identities`; `username`, `avatar_url`, and `email` are not used by current auth/product paths and are not persisted; `metadata` retains only Telegram's validated `telegramBotUserId` because the notification worker uses it, while all other metadata and raw provider payload are dropped.
- Development verification-code logging no longer writes phone numbers or codes.
- Added a dry-run-first manual CLI deletion workflow with explicit case/customer confirmation. It revokes sessions, removes optional profile/social/auth state, records marketing revocation and a low-data audit event, and preserves order/payment/fiscal records. No scheduler or automatic deletion job was introduced.

## Remaining limitations and owner facts

- Loyalty now has an explicit, versioned join action. Profile reads are read-only and card/Wallet endpoints require current acceptance. Revocation from the user's profile is not implemented yet; a material rules version change prompts for renewed acceptance.
- Marketing preferences created by lead forms are attached to a lead/candidate record, so they are not yet looked up across later submissions by the same contact. Current one-time reuse is implemented for customer accounts.
- The lead one-time marketing preferences are attached to a lead/candidate record, so later leads by the same contact do not reuse that preference. Account marketing choices remain one-time per current document version and revocable in profile.
- Loyalty self-service exit remains a product follow-up; it is separate from marketing preferences and normal ordering.
- Retention periods, backup expiry, legal holds, log expiry, and reapplication after restore need owner confirmation before the executable deletion workflow is used.
- Provider/processor legal entities, actual resource country/address, production feature flags, cross-border processing, first processing dates, prior RKN notice, and incident contacts remain owner facts. No geography is inferred from provider names.

## Database and release notes

Forward migrations `20261008100000_correct_checkout_consent_basis.sql` and `20261008120000_minimize_social_identity_data.sql` are not applied to production by this branch task. The first retains old RPC arguments for compatibility, removes the order PD-consent gate/evidence row, adds atomic lead evidence, preserves offer evidence/order flags, and adds cookie document-version evidence. The second clears unused social profile claims but preserves the exact Telegram recipient ID used by order-status notifications. Both require the normal production migration process before these code paths are released.

The full SQL migration chain and runtime migrator were exercised on disposable PostgreSQL 17. The new checkout RPC, lead-consent rollback, deletion preview/execution, session revocation, consent revoke, and order/payment/fiscal preservation passed integration checks there. The migrations are forward-only; application rollback keeps old RPC signatures/columns, though an older app version could write the social profile extras again if users log in after rollback.
