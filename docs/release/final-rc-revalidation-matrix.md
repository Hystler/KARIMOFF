# RC Revalidation Matrix

Application source: 32edb9b; branch release/karimoff-2026-10; 2026-10-03.
PASS applies only to its column. OFF is an activation decision, not complete implementation.

| Feature | CODE | UNIT | DB INTEGRATION | BROWSER | STAGE | REAL PROVIDER | REAL HARDWARE | THIS RC IN PRODUCTION |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Migration/runtime separation | PASS | fail-fast PASS | fresh/upgrade PG17 PASS | runtime health PASS | NOT RUN | N/A | N/A | NOT DEPLOYED |
| Runtime DML, DDL denied | PASS | startup guards PASS | 42501 assertions PASS | catalog/staff reads PASS | NOT RUN | N/A | N/A | NOT DEPLOYED |
| POS concurrency/UNKNOWN | PASS with fiscal-proof limitation | mock PASS | locks/restart/late callback/manual-cancel guard PASS | OFF controls rendered | NOT RUN | acquiring NOT RUN | NOT RUN | OFF planned |
| POS exact fiscal identity/import | Separate branch only | not this RC | not this RC | not this RC | NOT RUN | NOT RUN | NOT RUN | OFF planned |
| YooKassa verification/retry | PASS | provider mocks PASS | duplicate/out-of-order/expired window PASS | return empty state | NOT RUN | NOT RUN | N/A | NOT DEPLOYED |
| Two receipt triggers | PASS | payload PASS | pickup handout/delivery delivered PASS | staff screens rendered | NOT RUN | NOT RUN | N/A | NOT DEPLOYED |
| Delivery zone/price/hours | PASS with unconfirmed map | edges/failure PASS | fee/snapshot/late payment PASS | mock geocoder/checkout PASS | NOT RUN | Yandex NOT RUN | N/A | OFF planned |
| Address whitelist alternative | Separate branch only | not this RC | not this RC | not this RC | NOT RUN | N/A | N/A | NOT DEPLOYED |
| Pickup public display | PASS | predicate/PII PASS | underlying queue tests | six sizes PASS | NOT RUN | N/A | terminal browser NOT RUN | NOT DEPLOYED |
| Analytics/inventory | PASS with exact-import limitation | dimensions/formulas PASS | confirmed link/one deduction PASS | hub/journal PASS | NOT RUN | actual acquirer/import NOT RUN | NOT RUN | NOT DEPLOYED |
| UI/cart/modifiers | PASS | customization PASS | server price PASS | 130 combined checks PASS | NOT RUN | OAuth NOT RUN | Safari/iPhone NOT RUN | NOT DEPLOYED |
| Wallet | OFF guard PASS | config PASS | N/A | unavailable without opt-in | NOT RUN | NOT RUN | N/A | OFF planned |
| Restore | harness PASS | N/A | synthetic counts/hashes PASS | restored final app PASS | NOT RUN | Timeweb restore NOT RUN | N/A | NOT RUN |

No paid stage was created. Tests use only loopback synthetic PG17 fixtures and blocked
external fetch; actual provider/device credentials are absent. TEST_ORDER_MODE is not
the isolation proof. See final-rc-revalidation-20261003.md and selected evidence for limits.
