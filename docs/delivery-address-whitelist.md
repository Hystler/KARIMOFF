# Delivery address whitelist

## Runtime behavior

The checkout uses the `delivery_addresses` table for one active `order_locations` row. The customer selects a street and then a house returned by local database queries. The browser submits only `delivery_address_id` and optional apartment, entrance, floor, intercom, and courier comment. The server checks the address ID and location, and the order RPC repeats that check under a row lock before it takes the address snapshot from the database. City is nullable metadata and is never used to decide availability.

There are no Yandex Geocoder, GeoSuggest, DaData, or other geocoding calls in delivery checkout. Existing unrelated map functionality is outside this feature.

## Source and licensing

The initial address source is OpenStreetMap through the Overpass API. The importer stores the OSM element IDs, source timestamp, coordinates, and source URLs with preview output and database rows. It does not invent a city when `addr:city` is missing.

OSM data is under ODbL 1.0. Public use requires suitable attribution, and the license has share-alike terms for certain databases and derivative databases. Keep the attribution and license links available with the whitelist and any public disclosure of derived data. The project records provenance and attribution but does not assert that a specific deployment or distribution meets every ODbL obligation; obtain legal review for that determination.

- Source: [OpenStreetMap](https://www.openstreetmap.org/)
- Attribution guidance: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
- License: [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)

The public open-data endpoint returns only enabled OSM-sourced whitelist rows. It includes the OSM attribution, snapshot version, and an explicit notice that the exported OSM-derived address database extract is made available under ODbL 1.0. It omits delivery-distance calculations, customer delivery details, contacts, order history, and admin review fields. The endpoint returns a machine-readable JSON copy of the enabled address extract.

## Import and review

Running the importer without `--apply` only writes local preview files:

```sh
node scripts/import-delivery-addresses.mjs \
  --input outputs/source-snapshot.json \
  --source-url https://overpass-api.de/api/interpreter \
  --against outputs/previous-snapshot.json \
  --output outputs/delivery-whitelist-review-YYYY-MM-DD
```

Omit `--input` to fetch a fresh Overpass snapshot. The default operation is dry-run. The preview contains a summary, normalized records, CSV lists, source diff, duplicate and suspicious records, GeoJSON, and an HTML geometry review. Generated `outputs/delivery-whitelist-review-*` directories are ignored by Git.

The classification rules are:

- `AUTO-APPROVABLE`: less than 2,800 m; outside and over 100 m from the aerodrome polygon; normalized address is unambiguous; no suspicious flags or conflicting coordinates.
- `MANUAL REVIEW`: 2,800–3,000 m, within 100 m of the polygon, materially conflicting source coordinates, or another recorded ambiguity. Imported disabled.
- `OUTSIDE ZONE`: over 3,000 m or inside/on the excluded polygon. Kept in the report and never seeded into the runtime whitelist.

Duplicate OSM objects with the same normalized street, house, and building and maximum pairwise coordinate spread at or below 30 m collapse into one record. The deterministic medoid object supplies coordinates and source ID. A spread over 30 m creates one disabled manual-review address rather than multiple whitelist rows. The 30 m cutoff is an operational ambiguity threshold, not a statement that two real buildings can never be that close.

The first approved seed can be applied only after the generated preview has been reviewed. `--apply` requires an explicit location UUID and `DATABASE_URL`; by default it accepts loopback PostgreSQL only. A remote target additionally requires the explicit `--allow-remote` option. Apply runs in one transaction, upserts by location and normalized address, never deletes rows absent from a source snapshot, and preserves admin-disabled/rejected rows. If a previously whitelisted source address moves beyond the radius or into the aerodrome, the existing row is updated and disabled; it is not deleted. Changed coordinates that remain in-zone are staged as manual review. Review rows remain disabled until an administrator approves them.

Example local seed:

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:55444/karimoff_audit \
  node scripts/import-delivery-addresses.mjs \
  --input outputs/source-snapshot.json \
  --output outputs/delivery-whitelist-review-YYYY-MM-DD \
  --apply --location-id 00000000-0000-4000-8000-000000000001
```

For future remote seed runs, pass `--allow-remote` only after the dry-run report and location UUID have been reviewed. This document does not authorize or perform a production write.

## Refreshes

For a periodic refresh, keep the source JSON from the prior run and pass it with `--against`. The report classifies `NEW`, `REMOVED FROM SOURCE`, `COORDINATES CHANGED`, and `UNCHANGED`. Source removals are informational only; they do not delete or disable existing rows. New auto-approvable rows may be upserted by an explicit apply run. Manual-review rows remain disabled. Coordinate changes are staged for review.

Administrators may also add a house manually in **Admin → Delivery → Addresses**. Manual entries are disabled for review by default. Admin actions record audit events. The review queue supports bulk approval or rejection, and approval rechecks the local radius and polygon rules.

## Geometry review

The 3 km circle uses the store point `55.909221, 38.055708`. The imported polygon is the existing OSM aerodrome polygon and is not altered by the whitelist change. A point inside or on its boundary is excluded. Addresses within 100 m of the boundary stay in manual review.

The generated `review-map.html` is a geometry-only SVG; it has no map tiles. Its A1–A8 links open the corresponding coordinates on current Yandex Maps for human visual comparison. Review the settlement edge, runway/fence edge, and nearby residential blocks against the polygon. Zero OSM house points inside the polygon is not evidence that the polygon is correct. Do not scrape map content.
