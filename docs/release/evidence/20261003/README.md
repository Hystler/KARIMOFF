# Safe RC Evidence

All database/browser evidence uses synthetic local PostgreSQL fixtures and dummy credentials.
No real customer address, provider operation or physical device is involved.

- database-ready.json: fresh/upgrade grants, negative DDL assertions, synthetic restore integrity.
- browser-results.json: 126 six-viewport checks on the combined Docker RC.
- runtime-smoke.json: fresh and upgraded DB health/catalog under runtime-only credentials.
- tests.log: full 404-test run, 0 failed, 0 skipped.
- lint.log / typecheck.log / build.log: final checks.
- npm-audit.json: unresolved forge advisory, 2 high / 0 critical.
- Selected PNGs: local customer checkout, admin and public screens; synthetic fixtures only.
- production-readonly.json: explicitly selected non-secret platform/backup observations.

Full generated logs, screenshots and synthetic.dump remain outside Git in ignored
outputs/release-20261003. Restore duration here is not a production RTO guarantee.
