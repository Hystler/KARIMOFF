# Admin Workspace Audit - 2026-09-11

## Changes

- Compact desktop workspace, navigation, overview, POS, inventory, production, staff, economics and analytics. Narrow grids shrink or stack; wide data tables scroll within their own region.
- Ingredients and a separate Extras navigation item share dense nutrition tables. Values show kcal and protein/fat/carbohydrate quantities per inventory unit, per extra portion and per 100 g when mass is known. Missing/partial nutrition, unknown density/mass, estimated references and portion mismatches are explicit.
- The former minimum-stock column is named `Порог закупки`: the replenishment threshold, not a second stock balance.
- Kitchen has two persistent station views, independent mixed-order progress, adaptive queue widths and bounded desktop scrolling. See `kitchen-pilot-stations.md` for accounting and rollout details.
- Pilot order completion permits negative inventory while retaining complete sale movements. Strict mode remains available in kitchen settings. Production and manual write-off shortage guards are unchanged.
- Removed duplicate URI decoding from admin error messages; a literal percent sign no longer crashes the page. Fixed the analytics chart SVG title hydration mismatch.

## Verification

All mutations used synthetic records in the disposable local PostgreSQL database on port 55440. No live orders, payment requests, fiscal receipts or notification deliveries were created by the audit.

- Full browser run: `outputs/admin-ui-audit/2026-09-11T16-56-29.027Z/report.json`, 120 page captures, 417/418 assertions initially passed. The only remaining failure was the analytics hydration error in a capture made before its fix.
- Targeted rerun after that fix: `outputs/admin-ui-audit/2026-09-11T17-00-58.231Z/report.json`, 19/19 assertions passed, including analytics, kitchen, populated extras, protected access and logout.
- No document overflow, clipped-control candidates or broken images in the full run. Screenshots were visually inspected for ingredients, extras, inventory, production, overview, POS, kitchen, economics and analytics.
- Viewports: 1440x900, 1152x720, 1800x1125 and 390x844. The middle desktop variants model 125% and 80% zoom using effective CSS viewport plus device scale factor; native browser zoom was not automated.
- Browser workflows covered ingredient create/edit, extras price persistence, production create/edit, inventory receipt/correction/write-off, staff create/disable, POS-to-database ordering, independent kitchen station completion, unpaid handout rejection, public cart persistence and logout.
- Final automated test run: 342 passed, 0 failed, 20 skipped. Skips are pre-existing opt-in integration suites; dedicated kitchen and food-cost PostgreSQL checks ran against the disposable database, including hot-dog routing and the legacy queue fallback.
- Production build and TypeScript compilation passed. ESLint reported no errors; the existing CartProvider navigation warning remains outside this change.

## Release Notes

Timeweb only. Production and the test stand share a database; apply the forward kitchen migration through production startup before updating the read-only test stand. Preserve all existing environment flags and deploy full commit hashes. No secrets or local audit outputs belong in Git.

The first deployment built successfully but failed startup because the new migration was omitted from the Docker allowlist/runtime COPY list. Timeweb restored the preceding container before the new migration ran. Both packaging lists were corrected; a regression test now checks every startup migration against both lists.

Negative stock is an explicit pilot policy, not reconciled physical stock. Unknown nutrition remains unknown and must be completed from labels or confirmed recipes. External payment/fiscal providers and actual customer orders were not exercised.
