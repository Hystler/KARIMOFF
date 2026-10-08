# Manual personal-data request workflow

This is an operator workflow, not an automated deletion job. Do not run a broad delete against production. The operator must use the approved, access-controlled support/admin process and keep payment, fiscal, accounting, and order evidence required by law or to establish/defend claims.

1. Register the request in the restricted support case system. Assign a case ID and record the received timestamp, requested action, and requested contact channel. Do not copy full identity documents into the case unless a separate approved process requires them.
2. Verify the requester using an already verified account/contact and a proportionate challenge. Record the verification method and result, not OTPs, passwords, tokens, or identity-document images.
3. Find records by verified customer/lead identity. Inventory account/profile extras, social identities, avatars, active sessions, marketing consent, loyalty state, orders, payment/fiscal rows, support notes, and backups. Ask legal/accounting to determine statutory retention and active legal holds before changing order-related records.
4. Delete or anonymize optional profile fields, social identity extras that are no longer required for authentication, uploaded optional material, and other data with no remaining purpose. Revoke voluntary marketing consent and keep only the minimal suppression/evidence row required to prevent reactivation. Preserve the consent/version history needed to evidence the user's choice.
5. Revoke all active customer sessions and invalidate the browser session. Do not delete payment, fiscal, accounting, or order records required by law or ongoing claims. Where direct deletion would break their integrity, remove or replace identifying links only after the responsible owner approves the method.
6. Add a restricted audit event containing case ID, operator, completion time, categories deleted/anonymized, categories preserved with reason, and session-revocation result. Do not repeat the deleted personal data in the audit event.
7. Confirm completion to the requester through the verified channel. Record any remaining legal hold or backup expiry dependency. A restored backup must have the approved deletion/suppression actions reapplied before it is returned to service.

## Executable operator step

The repository includes `scripts/delete-customer-personal-data.mjs`. It accepts a customer UUID only and reads its connection from the dedicated `PERSONAL_DATA_DELETE_DATABASE_URL` variable; it never falls back to the app's normal `DATABASE_URL`.

First run a read-only preview:

```sh
PERSONAL_DATA_DELETE_DATABASE_URL="$OPERATOR_DATABASE_URL" node scripts/delete-customer-personal-data.mjs --customer-id CUSTOMER_UUID
```

After completing identity verification, statutory-retention and legal-hold review, run with a recorded case UUID and explicit customer-ID confirmation:

```sh
PERSONAL_DATA_DELETE_DATABASE_URL="$OPERATOR_DATABASE_URL" node scripts/delete-customer-personal-data.mjs --customer-id CUSTOMER_UUID --request-id CASE_UUID --execute --confirm-customer-id CUSTOMER_UUID
```

The operation revokes sessions; deletes avatar configuration, verification codes, pending auth state, and auth-link attempts; clears optional social claims and birthday; and records a marketing revocation when the current state is granted. It keeps the provider ID needed for account linking/duplicate prevention and preserves customer/order/payment/fiscal/accounting rows. The transaction writes a request-ID-based audit event without copying the deleted claim values. Reusing the same customer and case UUID is idempotent. Review the dry-run output and the post-run counts without copying phone/name values into the support record.

The script does not settle retention periods, backup expiry, legal holds, or statutory retention; those are owner facts to confirm before execution. It does not delete backups. After a restore, approved deletion/suppression actions must be reapplied before service resumes.
