# KARIMOFF image performance audit

Date: 2026-07-30

Targets:

- Production: `https://karimoff.site`
- Timeweb PostgreSQL/S3 stand: `https://hystler-karimoff-stand-ad9d.twc1.net`

The audit used isolated Chrome DevTools browser contexts, no network or CPU throttling, a
cache-bypassing first navigation, and a normal repeat reload. Measurements are lab
observations from the same browser and network, not long-term field percentiles.

## Executive finding

`STORAGE_PROVIDER=s3` only changes where **new uploads** are written. It does not rewrite
absolute URLs already stored in PostgreSQL. Both the Supabase source and the Timeweb copy
still contain six `site_settings.*_hero_image_url` values pointing to Supabase Storage.
Consequently, the Timeweb stand renders its `/menu` LCP image from Supabase, not Timeweb S3.

The slowest observed navigation was the cold Timeweb `/menu` request:

- LCP: **6,838 ms**
- document TTFB phase: **1,888 ms**
- hero request total time after queueing: **4,862 ms**
- active hero download: **140 ms**
- hero initial priority: **Low**, later promoted to **High**

The large gap is request scheduling/connection wait, not transfer throughput. The hero was
discoverable and not lazy, but it lacked `fetchpriority="high"`.

## Page comparison

| Target | Route | Cache | LCP | Document TTFB phase | LCP image | Image source | Image request |
| --- | --- | ---: | ---: | ---: | --- | --- | ---: |
| Production | `/` | cold | 988 ms | 467 ms | `rustam-package.jpg` | local public asset | 229 ms |
| Timeweb stand | `/` | cold | 1,072 ms | 582 ms | `rustam-package.jpg` | local public asset | 333 ms |
| Production | `/menu` | cold | 2,106 ms | 1,166 ms | `hero/menu.webp` | Supabase Storage | 831 ms |
| Timeweb stand | `/menu` | cold | 6,838 ms | 1,888 ms | `hero/menu.webp` | Supabase Storage | 4,862 ms |
| Production | `/` | warm | 224 ms | n/a | `rustam-package.jpg` | local, conditional request | 57 ms, 304-equivalent |
| Timeweb stand | `/` | warm | 216 ms | n/a | `rustam-package.jpg` | local, conditional request | 13 ms, 304-equivalent |
| Production | `/menu` | warm | 1,284 ms | n/a | `hero/menu.webp` | browser-cached Supabase | 0 transferred |
| Timeweb stand | `/menu` | warm | 548 ms | n/a | `hero/menu.webp` | browser-cached Supabase | 0 transferred |

Cold numbers naturally vary with network and origin wake-up. The source selection, headers,
priority, cache behavior, and request graph were consistent.

## LCP resources

### Home

Before this branch:

- URL: `/assets/hero/rustam-package.jpg`
- status: `200`, no redirect
- type: `image/jpeg`
- source size / transferred body: `159,580 B`
- `Cache-Control: public, max-age=0`
- production cold TTFB/download: `163.7 / 56.0 ms`
- stand cold TTFB/download: `130.9 / 192.2 ms`
- repeat load: a conditional request transferred about `300 B`
- initial priority: `Low`
- a separate `karimoff-hero-placeholder.svg` request was also made

The page is prerendered and currently uses the local fallback rather than the saved
`home_hero_image_url`.

### Menu

Before this branch:

- URL: `https://isjdtrfrmwntsmddtzxr.supabase.co/storage/v1/object/public/hero/menu.webp`
- status: `200`, no redirect
- type: `image/webp`
- source size: `229,156 B`
- `Cache-Control: public, max-age=31536000`
- Supabase Smart CDN: `CF-Cache-Status: HIT`
- production cold total/active download: `831 / 95 ms`
- stand cold total/active download: `4,862 / 140 ms`
- initial/final priority: `Low / High`
- browser repeat load: `0 B` transferred

The image is already WebP and is loaded directly. It is not passed through `/_next/image`,
so there is no double encoding for page heroes.

## Product images requested on the first viewport

All rows below were status `200`, no redirect, served through `/_next/image`, returned as
`image/avif`, and had
`Cache-Control: public, max-age=14400, must-revalidate` plus `x-nextjs-cache: HIT`.
The upstream files are local WebP files.

| Image | Source WebP | Optimized AVIF | Prod TTFB / download | Stand TTFB / download |
| --- | ---: | ---: | ---: | ---: |
| `rokki.webp` | 105,052 B | 29,151 B | 51.4 / 77.9 ms | 83.9 / 314.8 ms |
| `sebastian.webp` | 91,994 B | 24,923 B | 49.4 / 77.0 ms | 84.5 / 306.8 ms |
| `kantrigrand.webp` | 68,744 B | 20,220 B | 48.6 / 63.5 ms | 83.7 / 284.0 ms |
| `borak-abama.webp` | 94,020 B | 33,264 B | 49.4 / 79.2 ms | 84.0 / 319.8 ms |
| `voin-drakona.webp` | 99,248 B | 26,938 B | 41.6 / 35.2 ms | 47.4 / 208.7 ms |
| `kantribif.webp` | 98,176 B | 24,783 B | 45.4 / 68.3 ms | 81.4 / 293.3 ms |
| `tayson.webp` | 99,508 B | 26,132 B | 41.9 / 61.7 ms | 46.8 / 319.8 ms |
| `firmennaya-shaurma.webp` | 105,284 B | 54,846 B | 45.1 / 84.9 ms | 81.2 / 326.0 ms |
| `...govyadinoy.webp` | 108,576 B | 25,153 B | 44.1 / 68.4 ms | 81.3 / 306.9 ms |
| `...svininoy.webp` | 103,246 B | 24,674 B | 46.8 / 68.7 ms | 80.8 / 296.9 ms |
| `...kurochkoy.webp` | 134,716 B | 29,959 B | 48.1 / 77.0 ms | 81.2 / 311.4 ms |
| `...krevetkoy.webp` | 93,450 B | 25,164 B | 46.1 / 68.7 ms | 81.3 / 293.2 ms |

The browser viewport was `1165x699` at DPR 2. There were 32 product/hero images in the DOM,
but only 13 had decoded data after the initial load. Nineteen below-view images remained
unrequested. Native lazy loading therefore works, although Chrome intentionally fetches a
small margin below the viewport.

On repeat reload all optimized product rows had `transferSize=0` and
`deliveryType=cache`.

## Database URL inventory

Read-only queries against production Supabase and Timeweb PostgreSQL returned the same media
locations:

- `site_settings.home_hero_image_url` -> Supabase `hero/home.webp`
- `site_settings.menu_hero_image_url` -> Supabase `hero/menu.webp`
- `site_settings.business_hero_image_url` -> Supabase `hero/business.webp`
- `site_settings.careers_hero_image_url` -> Supabase `hero/careers.webp`
- `site_settings.franchise_hero_image_url` -> Supabase `hero/franchise.webp`
- `site_settings.about_hero_image_url` -> Supabase `hero/about.webp`
- `products.image_url` -> local `/assets/products/placeholder-*.svg` values in the database;
  known menu rows are enriched by the local fallback dataset
- `product_images.image_url` -> no non-empty rows
- `avatar_assets.image_url` -> no non-empty rows

No image requested by the audited production or stand pages came from Timeweb S3.

## Timeweb S3 validation

`S3_PUBLIC_BASE_URL` has the correct bucket-root form:

`https://s3.twcstorage.ru/karimoff-public-media`

All six copied hero objects returned:

- status `200`, no redirect
- `Content-Type: image/webp`
- expected byte size matching the migration map
- `Cache-Control: public, max-age=31536000, immutable`

The S3 metadata is technically valid for immutable objects. The copied names
(`hero/home.webp`, `hero/menu.webp`, and so on) are not content-versioned, however, so
overwriting those keys would make `immutable` unsafe. This branch makes future uploads use
a SHA-256 suffix before applying immutable caching.

## Next image optimizer and container cache

Before this branch, local WebP product images were resized and transcoded to AVIF. This gives
good transfer sizes, but AVIF has higher first-request encoding cost. The response cache is
stored under the running Next.js container filesystem. The Docker image does not copy a
warmed `.next/cache/images` directory and Timeweb does not mount a persistent cache volume.
Therefore:

- browser cache survives normal repeat navigation;
- `x-nextjs-cache: HIT` survives while the same container cache exists;
- a new deployment/container starts with a cold optimizer cache;
- multiple replicas do not share the optimizer cache.

The branch keeps resizing because it materially reduces product bytes, but returns WebP
instead of performing WebP-to-AVIF conversion. It also raises optimizer TTL to 31 days for
the life of a container.

A clean local production container confirmed the behavior:

- first `/_next/image` request: `X-Nextjs-Cache: MISS`
- immediate repeat: `X-Nextjs-Cache: HIT`
- output: `image/webp`
- optimized cache header: `public, max-age=2678400, must-revalidate`

## Implemented corrections

- Hero images now use `loading="eager"` and `fetchPriority="high"`.
- Hero dimensions are explicit (`2400x1200`) and no layout space is inferred late.
- Local home fallback is WebP and content-versioned in the URL.
- Local fallback transfer source is reduced from `159,580 B` JPEG to `129,122 B` WebP.
- The old placeholder background request is removed.
- The logo no longer prefetches the home route hero while the user is on `/menu`.
- Product images explicitly remain lazy/low-priority with tighter responsive `sizes`.
- Extra 480/512 pixel optimizer candidates reduce over-sized card requests.
- Optimizer output is WebP with a 31-day minimum cache TTL.
- Legacy Supabase public media URLs are resolved to `S3_PUBLIC_BASE_URL` only when
  `STORAGE_PROVIDER=s3`; Supabase mode is unchanged.
- Optional `S3_CDN_BASE_URL` is supported for generated URLs, CSP, and Next remote patterns.
- Future uploaded image keys contain a content hash and are safe for immutable caching.
- Fixed local `/assets/*` URLs use a finite seven-day cache, not `immutable`.

## Remaining deployment-specific work

1. Deploy this branch to the stand with `STORAGE_PROVIDER=s3`.
2. Keep `S3_PUBLIC_BASE_URL=https://s3.twcstorage.ru/karimoff-public-media`.
3. Optionally set `S3_CDN_BASE_URL` to a CDN origin before rebuilding the app.
4. Re-run Chrome traces after the branch deploy. `/menu` should request the S3/CDN URL and
   pass the LCP priority check.
5. Do not change production providers until the database/storage cutover is separately
   approved.
