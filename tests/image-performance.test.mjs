import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const hero = read("src/components/Hero.tsx");
const pageHero = read("src/components/PageHero.tsx");
const productCard = read("src/components/ProductCard.tsx");
const logo = read("src/components/Logo.tsx");
const storageImages = read("src/lib/storage-images.ts");
const mediaUrl = read("src/lib/media-url.ts");
const nextConfig = read("next.config.mjs");

test("LCP heroes are eager, high priority, and do not load the old placeholder", () => {
  for (const source of [hero, pageHero]) {
    assert.match(source, /loading="eager"/);
    assert.match(source, /fetchPriority="high"/);
    assert.match(source, /width=\{2400\}/);
    assert.match(source, /height=\{1200\}/);
  }

  assert.doesNotMatch(hero, /karimoff-hero-placeholder/);
  assert.match(hero, /rustam-package\.webp\?v=[a-f0-9]{12}/);
});

test("product images remain lazy and use bounded responsive sizes", () => {
  assert.match(productCard, /loading="lazy"/);
  assert.match(productCard, /fetchPriority="low"/);
  assert.match(productCard, /\(min-width: 1280px\) 220px/);
  assert.doesNotMatch(productCard, /sizes="[^"]*20vw/);
});

test("S3 origin URLs map to an optional CDN without a provider fallback", () => {
  assert.match(mediaUrl, /S3_CDN_BASE_URL/);
  assert.match(mediaUrl, /S3_PUBLIC_BASE_URL/);
  assert.match(mediaUrl, /value\.startsWith\(`\$\{originBaseUrl\}\//);
  assert.doesNotMatch(mediaUrl, /STORAGE_PROVIDER/);
  assert.doesNotMatch(mediaUrl, /supabase/i);
  assert.doesNotMatch(nextConfig, /supabase/i);
});

test("new uploads are content-versioned before receiving immutable caching", () => {
  assert.match(storageImages, /createHash\("sha256"\)/);
  assert.match(storageImages, /versionedPath/);
  assert.match(nextConfig, /minimumCacheTTL: 2678400/);
  assert.match(nextConfig, /formats: \["image\/webp"\]/);
});

test("home logo does not prefetch an unrelated hero on internal pages", () => {
  assert.match(logo, /prefetch=\{false\}/);
});
