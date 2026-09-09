# YooKassa Payment and Fiscal Audit

Date: 2026-09-08. Checkout: `/Users/akimkovalenko/Desktop/KARIMOFF`. Branch name supplied by the requester: `codex/planning-notifications-audit`; Git was not inspected or operated on.

## Decision

**Both confirmed SQL P1 defects, plus the reviewed paid-payment/provider and prepayment-receipt regressions, are fixed in a new migration and verified on disposable PostgreSQL 17.10.** The earlier application fixes cover settlement keys rejected locally and creation retries outliving provider idempotency. The final full suite passed **298/298**, including all **17 active database tests**, with no TODO or skipped tests when the explicit local test DSN is supplied.

**Not a production clearance:** the new migration has only been applied to the disposable database. After separate review, it must precede deployment/enabling of the updated payment flows; startup does not auto-apply it. Parent fixes resolve the same-tab checkout TTL and in-flight snapshot defects, but cross-tab recovery and F6/F7 remain open. All provider interactions in this audit are mocks, including the test payment. No live or provider-sandbox payment, refund, receipt, or webhook was sent.

## Findings

### F1. P1, Fixed: Every Settlement Key Was Rejected Before Sending

The handout trigger persists `yookassa:payment:<36-character-payment-id>:settlement` (63 characters). The client previously allowed no colon, so every settlement POST failed with `INVALID_IDEMPOTENCE_KEY`. The existing suite tested the receipt builder but never sent this persisted key through the actual client. The new service/client behavioral test reproduced the rejection before the fix.

The client now accepts colons without changing any persisted key. Length remains capped at 64 and CR/LF remain rejected. This fits the official key contract, which does not restrict keys to UUIDs. [YooKassa idempotency](https://yookassa.ru/developers/using-api/interaction-format#idempotence).

Evidence: [client.ts:29](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/payments/yookassa/client.ts:29), [settlement trigger:430](/Users/akimkovalenko/Desktop/KARIMOFF/supabase/migrations/20260827143000_refine_yookassa_fiscal_operations.sql:430), [behavioral reproduction](/Users/akimkovalenko/Desktop/KARIMOFF/tests/yookassa-behavior.test.mjs:144).

### F2. P1, Fixed: Missing Provider IDs Could Cause New Operations After 24 Hours

The settlement queue allows 72 hours of work. Payment/refund queue claims have shorter limits, but direct service calls did not enforce creation age. After an accepted POST whose response/ID was lost, replaying an unchanged body/key beyond the provider retention window could create a new operation. Before the fix, the 25-hour payment and refund tests made a POST instead of rejecting; the fiscal reproduction initially hit F1 first.

Every current payment/refund/settlement creation call now passes a deadline based on its persisted attempt's `created_at`, with a one-minute safety margin. The HTTP client checks it before **each** POST attempt, including retries after sleep. Invalid/missing timestamps fail closed. Known provider IDs still use GET beyond that deadline. Expiry records `IDEMPOTENCE_WINDOW_EXPIRED`, stops automatic retries, and does not declare the payment/refund failed or release reserved refund money. Fiscal permanent errors now stop scheduling as well.

This is deliberately conservative: an unsent operation already older than the limit also needs review. No reliable first-POST timestamp exists in the current schema; one was not invented from mutable `updated_at`. The deadline is not a guarantee against arbitrary host clock skew, process suspension, or provider-side delays. Do not rotate the key to recover an ambiguous operation. YooKassa guarantees deduplication for 24 hours after the first request, not forever. [Official interaction contract](https://yookassa.ru/developers/using-api/interaction-format).

Evidence: [retry.ts:3](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/payments/yookassa/retry.ts:3), [client.ts:158](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/payments/yookassa/client.ts:158), [service.ts:215](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/payments/yookassa/service.ts:215), [service.ts:345](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/payments/yookassa/service.ts:345), [service.ts:439](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/payments/yookassa/service.ts:439).

### F3. P2, Fixed: Fiscal Responses Could Rewind or Rebind a Finished Receipt

The fiscal recorder previously unconditionally replaced status and provider ID. Two workers receiving pending/succeeded responses in the opposite completion order could regress an issued receipt to pending. The service also accepted a missing `payment_id` and did not check receipt type or an already-bound receipt ID.

The service now skips terminal fiscal rows, requires the expected payment/type/known receipt ID, and refuses to restart terminal payment attempts. The fiscal UPDATE accepts only the same provider ID and pending-to-result or same-status updates. Late failure handling cannot reschedule a terminal receipt. Both service validation and the actual repository SQL passed behavioral tests on the authorized disposable PostgreSQL 17.10. The SQL test applies succeeded, stale pending, stale canceled, a different receipt ID and a late failure; the row stays issued with its original provider ID and no next retry.

Evidence: [service.ts:322](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/payments/yookassa/service.ts:322), [repository.ts:668](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/payments/yookassa/repository.ts:668).

### F4. SQL P1, Fixed Locally: Terminal States and Refunded-Money Cap

Before the new migration, `apply_yookassa_refund_state` derived `completed/failed/pending` solely from the latest arriving response, without preserving an existing terminal refund. Sequence: worker A reads pending, worker B applies succeeded, A applies its older pending. The completed refund disappeared from subsequent completed-refund sums. Separately, `apply_yookassa_payment_state` could overwrite `refundable_amount` with an older provider balance even though it had already calculated completed local refunds.

Evidence: [payment SQL:518](/Users/akimkovalenko/Desktop/KARIMOFF/supabase/migrations/20260827120000_add_yookassa_payment_integration.sql:518), [payment SQL:537](/Users/akimkovalenko/Desktop/KARIMOFF/supabase/migrations/20260827120000_add_yookassa_payment_integration.sql:537), [refund SQL:684](/Users/akimkovalenko/Desktop/KARIMOFF/supabase/migrations/20260827120000_add_yookassa_payment_integration.sql:684), [refund aggregate:736](/Users/akimkovalenko/Desktop/KARIMOFF/supabase/migrations/20260827120000_add_yookassa_payment_integration.sql:736).

**Confirmed on disposable PostgreSQL 17.10:** a completed refund became `pending` after the stale response; a payment with 100 of 200 already refunded had its refundable balance restored from 100 to 200 by the old payment response. The tests deterministically replay the harmful response order; they do not simulate concurrent processes or actual additional provider refunds.

After the explicit scope extension, added [20260908181028_harden_yookassa_refund_idempotency.sql](/Users/akimkovalenko/Desktop/KARIMOFF/supabase/migrations/20260908181028_harden_yookassa_refund_idempotency.sql). Historical migrations and the startup auto-apply list are unchanged.

- Payment state application caps the provider-reported refundable amount at `max(0, payment.amount - completed_yookassa_refunds)`; null/negative provider amounts become zero.
- Already-paid payments, including supported `partially_refunded`/`refunded` payment states, retain provider status `succeeded` when older pending/waiting/canceled responses arrive. Such responses retain the stored receipt registration, payment method and available balance, with the completed-refund cap still applied. Successful financial snapshots may still advance a pending receipt.
- Terminal payment `receipt_registration` (`succeeded`/`canceled`) is preserved. The prepayment receipt UPDATE independently excludes `issued`/`failed`/`cancelled` rows, protecting them even if a legacy payment's scalar receipt flag is inconsistent. A pending prepayment receipt can still finish as issued/failed. Binding, amount/currency and contradictory `succeeded`/unpaid checks run before normalization.
- Refund application locks the parent payment before the refund, matching refund creation and serializing balance recalculation for that payment. It rechecks the refund/payment binding after taking the locks.
- Completed/failed refund states cannot be rewound or revived by a stale or contradictory response. A completed refund's pending receipt can still become succeeded/canceled; a terminal refund receipt cannot be downgraded by pending/null registration.
- Replaying a completed refund cannot restore a lower provider-derived refundable ceiling: the update uses the smaller of the current available amount and the completed-refund cap. It does not subtract the refund amount again on duplicate delivery.
- Provider ID, amount and currency checks still run before terminal handling. Outbox events remain keyed once per refund.

The database suite reproduced eight failing checks on the old functions (including both original P1). Parent review then identified the remaining payment receipt/provider regressions; four additional behavioral checks failed before the follow-up guard. The final suite passes all 17 tests. It covers replay, late receipt completion, independent fiscal terminal state, lower/zero provider limits, full refund, actual repository reservation and duplicate-key reuse, binding rejection, outbox deduplication, and execution as `karimoff_app`. Financial terminal handling is consistent with [YooKassa response semantics](https://yookassa.ru/developers/using-api/response-handling/recommendations) and [refund processing](https://yookassa.ru/developers/payment-acceptance/after-the-payment/refunds).

Current canonical storage deliberately leaves `payments.status = paid` after refund completion; `orders.payment_status` becomes `partially_refunded`/`refunded`. This convention was preserved, not rewritten. The tests also seed supported legacy payment status variants to verify the guard. Evidence: [payment guard](/Users/akimkovalenko/Desktop/KARIMOFF/supabase/migrations/20260908181028_harden_yookassa_refund_idempotency.sql:67), [behavioral SQL tests](/Users/akimkovalenko/Desktop/KARIMOFF/tests/yookassa-db-behavior.test.mjs:211).

### F5. P1/P2, Partially Fixed by Parent: Checkout Recovery and Cart Snapshot

The parent removed the 15-minute checkout-attempt expiry: the same cart payload reuses its unresolved key even after 48 hours and a lost create response. `rememberCheckoutPayment` now retains the original submission snapshot instead of capturing the cart when the response arrives. Missing attempt storage cannot authorize deleting the current cart. The parent's four behavioral tests pass, including cancellation release and rejection of an unrelated payment ID. These source/test edits were reviewed here but not made by this task.

**Residual:** independent tabs still have separate session storage. Lost/cleared storage or a separately generated key can still create another order/payment for the same intended purchase; provider idempotency cannot deduplicate different keys. A server-side recovery/cross-tab ownership contract remains follow-up work. The TTL and in-flight cart-loss findings are no longer open, but this is not cross-tab or browser end-to-end clearance.

Evidence: [attempt reuse](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/cart-checkout-storage.ts:39), [submission snapshot](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/cart-checkout-storage.ts:59), [parent's four recovery tests](/Users/akimkovalenko/Desktop/KARIMOFF/tests/cart-payment-recovery.test.mjs:20).

### F6. P2, Open: Refund/Settlement Coordination Is Not One Atomic Operation

The scheduler excludes pending refunds when claiming a settlement, and the handout/refund triggers snapshot completed refunds until the first fingerprint is bound. However, loading the receipt context and binding its fingerprint are separate operations; the binding transaction does not recheck pending refunds or the context's amount/refund snapshot. A full refund after handout is permitted and can race a claimed settlement. A full refund before the first fingerprint may also reduce settlement amount to zero while leaving the row pending; the receipt builder then rejects its nonempty items/zero total.

The simple key/deadline fix does not resolve this coordination problem. Follow-up needs an agreed full-refund-after-handout fiscal policy, atomic snapshot binding, and cancellation/closure of a zero-balance unsubmitted settlement. Partial refunds after handout are already rejected by the repository and are behaviorally tested.

Evidence: [claim:528](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/payments/yookassa/repository.ts:528), [binding:622](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/payments/yookassa/repository.ts:622), [refund snapshot trigger:329](/Users/akimkovalenko/Desktop/KARIMOFF/supabase/migrations/20260827143000_refine_yookassa_fiscal_operations.sql:329). Concurrency itself has not been exercised against PostgreSQL.

### F7. Conditional Double-Count Exposure: Evotor Needs a Confirmed Link

Import replay is keyed by `(connection_id, evotor_document_id)`, `(connection_id, external_receipt_id)`, and `(receipt_id, source_key)`. YooKassa code does not emit Evotor sales or inventory mutations. Canonical sales/items exclude the Evotor side only for a `confirmed` reconciliation; payment analytics also avoids adding its payment when a paid web payment already exists. Equal amount/time alone never establishes identity. Manual reconciliation enforces staff/location access, tested with the real action and mocked database boundary.

An unlinked late Evotor receipt still counts independently. The disposable database test confirmed the boundary: a 200-ruble web sale plus an unlinked 200-ruble Evotor sale yielded two sales/400 revenue; a confirmed link yielded one sale/200 revenue and one payment/200 amount. The one-order/one-receipt unique constraints cannot represent both an imported prepayment receipt and its separately imported settlement receipt for one order. The Evotor parser classifies SELL as a sale without distinguishing those fiscal phases. Thus a shared register/import feed containing both phases needs explicit reconciliation or phase-aware exclusions before it is double-count safe. Whether this deployment actually imports those receipts is unknown; no Evotor account/configuration was queried.

Evidence: [Evotor import:299](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/integrations/evotor/sync.ts:299), [parser:63](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/integrations/evotor/receipts.ts:63), [link uniqueness:4](/Users/akimkovalenko/Desktop/KARIMOFF/supabase/migrations/20260812213000_add_unified_sales_analytics.sql:4), [sales exclusion:142](/Users/akimkovalenko/Desktop/KARIMOFF/supabase/migrations/20260812213000_add_unified_sales_analytics.sql:142), [payment exclusion:314](/Users/akimkovalenko/Desktop/KARIMOFF/supabase/migrations/20260812213000_add_unified_sales_analytics.sql:314).

## Verified Protections and Provider Contract

- The existing server-priced atomic order/payment path, unique payment/order keys, immutable fiscal composition, and one outbox success key are present in SQL. Payment pending does not permit the kitchen to become operational. Execution of these SQL constraints is distinct from the source assertions in the existing JavaScript suite.
- The real HTTP client reuses serialized request bytes and the same key for payment/refund/receipt transport retries, including a lost response. HTTP 500 is treated as ambiguous, not proof of failure. [YooKassa response handling](https://yookassa.ru/developers/using-api/response-handling/recommendations).
- Webhooks only use the incoming object ID to GET current provider state, then check amount, currency, metadata and known object ID. Processed event replay stops before another GET. Concurrent unprocessed events are not exclusively claimed; SQL must provide final-state safety. The `signature_verified` column denotes provider GET verification, not a cryptographic webhook signature. YooKassa documents status/IP verification and redelivery for non-200 responses. [Official webhooks](https://yookassa.ru/developers/using-api/webhooks).
- Prepayment is embedded in the create-payment request. Payment success does not create an additional `/receipts` operation. Handout queues the distinct settlement using `full_payment` and `settlements.type=prepayment`, not a second cashless charge. The service waits for successful prepayment receipt registration. [YooKassa payment receipts and settlement](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/yoomoney/payments).
- Full refund requests omit `receipt`; partial refunds include allocated items with exact minor-unit totals. This matches the built-in YooKassa receipts scenario; third-party cash-register receipt workflows differ and must not be assumed interchangeable. [Built-in refund receipts](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/yoomoney/refunds), [third-party refund receipts](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/other-services/refunds). Tax rate/subject and the merchant's configured receipt product were not validated as business/legal facts.
- Refund preparation checks an active owner/admin, positive amount, reserved pending amounts, remaining item quantities, exact allocated totals and the handout restriction. Same-key replay uses the original persisted refund; changed allocation/reason with the same amount is not separately rejected. Financial creation retries remain bounded by F2.
- Return/status pages read the authenticated customer's local payment state, not success from redirect query parameters. The status route makes no provider POST. Cart finalization requires the matching remembered payment ID and unchanged snapshot; repeated finalization is harmless. The parent also added polling network-error recovery, an eight-second abort and scheduled initial polling in [PaymentReturnStatus](/Users/akimkovalenko/Desktop/KARIMOFF/src/components/payments/PaymentReturnStatus.tsx:49). Its [three behavioral tests](/Users/akimkovalenko/Desktop/KARIMOFF/tests/payment-return-recovery.test.mjs:34) pass for offline recovery, abort/in-flight release and hidden-page suppression. Those tests do not execute React effects or prove the initial scheduling/browser lifecycle. Full browser interaction and the F5 cross-tab residual remain unverified.

## Migration Readiness

- **Migration-first rollout is required for these protections. Production is not migrated.** After separate review and all prerequisite payment/fiscal migrations, apply this new migration before deploying/enabling the updated payment flows or resuming their workers. Its unchanged signatures are compatible with existing callers. Deploying code alone leaves the SQL P1 defects unfixed. The file was applied and reapplied only through `psql` in `karimoff-audit-20260908` (host loopback port 55439, database `karimoff_audit`). It was not added to `scripts/apply-runtime-schema-migrations.mjs` and is **not auto-applied at startup**. Do not replay historical function definitions over it.
- The migration is transactional and replaces only the two existing function bodies. It checks that both signatures already exist; it creates no tables/indexes, performs no data backfill and broadens no grants. Reapplication succeeded. Function OIDs, owners, ACLs, `SECURITY INVOKER` and fixed `search_path` were unchanged in PostgreSQL; calls as `karimoff_app` passed. Production must already have the reviewed prerequisite schema and equivalent role grants.
- The fix prevents new regressions; **it does not repair previously corrupted rows**. Before a production rollout, review ambiguous legacy refunds and balances against provider-authoritative records under a separate authorization. A pending row previously regressed from completed may not be included in the completed-refund cap until reconciled. Likewise, refunds initiated outside this application's ledger need explicit reconciliation.
- Terminal `failed` in this path means a provider-canceled refund, as produced by the existing application. Manually written statuses or other writers bypassing these functions are not made safe by a new table constraint. Future writers must preserve the payment-before-refund lock order and the completed-refund invariant. Tests replay stale response ordering deterministically; multi-connection lock contention was not stress-tested.
- The cap intentionally preserves a lower/zero available balance on refund replay. A later succeeded payment GET can update that provider ceiling, but never above the completed-local-refund cap; an older pending/canceled financial snapshot cannot overwrite it. Paid provider state and terminal payment/prepayment receipts are now protected too. This trusts previously verified terminal state, so preexisting inconsistent payment/fiscal flags need separate reconciliation, not automatic revival. F5's cross-tab residual and F6/F7 are not fixed by this migration.
- The tests only read `YOOKASSA_AUDIT_LOCAL_DSN`, never `.env` or application database configuration. The exact approved loopback DSN is checked before connecting; other endpoints fail closed. Without this explicit variable, database tests skip with a reason. **A run without the variable is not database verification.** No TODO markers remain.

Run after preparing the disposable schema and applying the new migration:

```sh
YOOKASSA_AUDIT_LOCAL_DSN=postgres://postgres@127.0.0.1:55439/karimoff_audit node --test tests/yookassa-db-behavior.test.mjs
```

This sets only a process-local, test-only variable. It does not edit any environment file or production configuration.

## Verification Log

1. Baseline `node --test tests/yookassa-integration.test.mjs`: **20 passed**.
2. New behavioral suite before source fixes: **7 passed, 4 failed**, exposing F1 and F2; fiscal expiry initially failed on the colon restriction.
3. First application-fix verification: **48 payment tests passed**, then **85 related tests passed**. The 28 new runtime tests execute current TypeScript in memory, with explicit mocks for configuration, logging, database boundaries and all provider HTTP calls. Unexpected network/import paths fail closed in that harness.
4. Final full suite with the explicit local DSN: `YOOKASSA_AUDIT_LOCAL_DSN=postgres://postgres@127.0.0.1:55439/karimoff_audit node --test --test-reporter=spec tests/*.test.mjs`: **298 passed, 0 failed, 0 skipped, 0 TODO**. This includes all 17 database tests and the parent's four cart and three return-recovery tests.
5. `node node_modules/typescript/bin/tsc --noEmit --incremental false`: **passed**, without writing build metadata.
6. Scoped ESLint: initially caught the test loader's local `module` variable; renamed it. Final scoped lint and the full non-emitting typecheck both **passed** after the database-test additions.
7. After the parent's explicit schema-ready confirmation, checked PostgreSQL **17.10** and the five required public functions (`create_site_order_with_payment`, both `apply_yookassa_*_state`, fiscal refresh and settlement queue). Ran `docker exec -i karimoff-audit-20260908 psql -X -v ON_ERROR_STOP=1 -U postgres -d karimoff_audit < supabase/tests/yookassa.sql`: **BEGIN / DO / ROLLBACK**, exit 0.
8. Initial SQL audit found **3 passed, 2 failing TODO regressions** (F4). After the user authorized a new migration, removed TODOs, switched to explicit local DSN and expanded the suite: old functions gave **4 passed / 8 failed**, confirming the regressions were active. An initial syntax error during migration development rolled back the entire migration; the corrected migration applied with **BEGIN / DO / CREATE FUNCTION / CREATE FUNCTION / COMMIT** and then reapplied successfully.
9. The first refund/cap migration version passed 12 database tests. Adding payment/prepayment regressions gave **13 passed / 4 failed** before their guard. After that guard, one test incorrectly expected a refunded payment row to use the order's status, giving the observed **16/17** intermediate result. The assertion now respects canonical paid storage and separately tests legacy variants; no application behavior was changed to satisfy the mistaken expectation.
10. Final targeted database run: **17 passed, 0 failed, 0 skipped, 0 TODO**, including the unchanged original transaction suite. The direct `psql` transaction suite also passed again. All fixture transactions rolled back, including pre-fix assertion failures. Identity/ACL comparisons confirmed unchanged ownership, grants, function OIDs and invoker settings. Cleanup reads verify no audit customers, staff, products or Evotor stores remain. SHA-256 checks confirmed both historical payment migrations and the startup list remained unchanged.

## Scope and Limits

This task edited only application files under `src/lib/payments/yookassa/`, `tests/yookassa-*.test.mjs`, this report, and the newly authorized forward migration. The parent's concurrent cart and return-polling changes and their tests were preserved. Historical payment migrations and the startup auto-apply list were not changed. No dependencies, environment files, shared database, production services, Git operations, deployment or publication. Existing suites use transient fixture files and synthetic child-process configuration; application secrets/configuration were not loaded. New runtime tests compile only in memory. New SQL tests target only the explicitly supplied and validated disposable endpoint.

The official YooKassa developer pages linked above were consulted on 2026-09-08; no third-party provider claims were used. The parent created and initially migrated the disposable database; this task subsequently applied only the explicitly authorized new migration there, plus rollback-only fixture tests and identity/cleanup reads. Production migration installation state, simultaneous workers, real YooKassa delivery/retention behavior, configured fiscal product, live Evotor feed, and UI/browser flows remain unverified. The operator status-check action is provider-read-only but does update verified local state; its name must not be interpreted as database-read-only. The later permission to add `supabase/tests/` files was not needed; all new SQL tests remain in `tests/yookassa-*.test.mjs`.

## Changed Files

- `src/lib/payments/yookassa/client.ts`
- `src/lib/payments/yookassa/retry.ts`
- `src/lib/payments/yookassa/service.ts`
- `src/lib/payments/yookassa/repository.ts`
- `tests/yookassa-integration.test.mjs`
- `tests/yookassa-behavior.test.mjs`
- `tests/yookassa-db-behavior.test.mjs`
- `supabase/migrations/20260908181028_harden_yookassa_refund_idempotency.sql`
- `docs/audit-2026-09-payments.md`
