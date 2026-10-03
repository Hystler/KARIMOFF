# Final RC Test Matrix

2026-10-03. Base 635fb4d plus stabilization commits listed in final-rc-stabilization.md.
PASS means evidence at the named level only. NOT RUN is not the same as failed.
No paid stage, production writes or real provider/device operations were used.

| Feature | CODE | UNIT | DB INTEGRATION | BROWSER | HOSTED STAGE | REAL PROVIDER | REAL HARDWARE | NEW PRODUCTION RC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Separate migration/runtime credentials | PASS | PASS | PG17 fresh/upgrade PASS | runtime health PASS | NOT RUN | N/A | N/A | NOT DEPLOYED |
| Runtime DML, DDL denied | PASS | startup fail-fast PASS | 42501 negative assertions PASS | staff/customer SQL PASS | NOT RUN | N/A | N/A | NOT DEPLOYED |
| Pickup checkout and tracking | PASS | PASS | creation/payment/status PASS | synthetic session PASS | NOT RUN | NOT RUN THIS TASK | N/A | NOT DEPLOYED |
| YooKassa verification/idempotency/retry | PASS | mock PASS | duplicate/expired-window PASS | return empty state only | NOT RUN | NOT RUN | N/A | NOT DEPLOYED |
| Two fiscal receipts | PASS | payloads PASS | pickup/delivery triggers PASS | staff views PASS | NOT RUN | NOT RUN | N/A | NOT DEPLOYED |
| Delivery zones/price/hours | PASS with unconfirmed map config | edge cases PASS | fee/snapshot/late-paid PASS | mock Yandex PASS | NOT RUN | Yandex NOT RUN | N/A | OFF |
| POS command state machine | PASS | bridge mocks PASS | concurrent/UNKNOWN/fiscal gate PASS | payment OFF UI PASS | NOT RUN | acquiring NOT RUN | NOT RUN | OFF |
| KDS/inventory | PASS | permissions/projections PASS | payment gate/recipe exactly-once PASS | staff route PASS | NOT RUN | N/A | physical recovery NOT RUN | NOT DEPLOYED |
| Pickup display | PASS | delivery exclusion/PII PASS | underlying queries in tests | six sizes PASS | NOT RUN | N/A | terminal browser NOT RUN | NOT DEPLOYED |
| Analytics | PASS, acquirer dimension still unknown | formulas/filters PASS | explicit reconciliation + unknown filter PASS | hub/journal PASS | NOT RUN | imported-ID acceptance outstanding | NOT RUN | NOT DEPLOYED |
| UI/polish/cart/modifiers | PASS | customization suites PASS | server pricing PASS | 126 checks/six sizes PASS | NOT RUN | real OAuth NOT RUN | Safari/iPhone NOT RUN | NOT DEPLOYED |
| Apple Wallet | gated OFF | configuration guard PASS | N/A | OFF distribution | NOT RUN | NOT RUN | N/A | explicit OFF planned |
| Restore | harness PASS | N/A | synthetic hash/count integrity PASS | restored RC PASS | NOT RUN | Timeweb backup restore NOT RUN | N/A | NOT RUN |

## Reproduction

Do not source production .env. Only disposable Docker/loopback DSNs are accepted by the harness.

```sh
node scripts/verify-release-database.mjs --local-only
```

Use runtimeDsn from outputs/release-20261003/database/ready.json for KARIMOFF_RC_LOCAL_DSN.
Existing PostgreSQL suites also require their explicitly isolated 55441/55442 fixtures:

```sh
YOOKASSA_AUDIT_LOCAL_DSN=postgres://postgres@127.0.0.1:55441/karimoff_audit \
KITCHEN_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55442/karimoff_audit \
FOOD_COST_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55442/karimoff_audit \
KARIMOFF_RC_LOCAL_DSN='<local runtimeDsn from ready.json>' npm test
```

The release run supplies all test DSNs: 404 passed, zero skips. Omitting opt-in DB fixtures
is not a release-valid test run. New runtime tests fail rather than silently accepting an external DSN.

```sh
npm run lint
npm run typecheck
npm run build
docker build -t karimoff-rc:20261003 .
PLAYWRIGHT_MODULE_PATH='<installed Playwright index.mjs>' \
  node scripts/verify-release-browser.mjs --local-only
```

Browser harness uses restored synthetic DB, random test sessions, dummy provider keys,
external-fetch deny preloader and no order/payment submission. It does not prove real OAuth.
It mutates only isolated fixtures and stops its own application container in finally.
Generated dumps/logs/screens remain in ignored outputs/release-20261003; selected safe evidence
is under evidence/20261003. Do not publish the whole outputs directory.
