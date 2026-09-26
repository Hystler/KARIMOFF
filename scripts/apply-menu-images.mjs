import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const catalog = JSON.parse(
  readFileSync(new URL("../data/catalog/menu-images-2026-09-26.json", import.meta.url), "utf8")
);
const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const apply = process.argv.includes("--apply");

function validateCatalog() {
  if (catalog.products.length !== catalog.expected_product_count) {
    throw new Error(`Expected ${catalog.expected_product_count} photos, found ${catalog.products.length}.`);
  }

  const seenSlugs = new Set();
  for (const product of catalog.products) {
    if (seenSlugs.has(product.slug)) {
      throw new Error(`Duplicate menu slug: ${product.slug}`);
    }
    seenSlugs.add(product.slug);

    if (!product.image_url.startsWith("/assets/products/") || product.image_url.includes("..")) {
      throw new Error(`Unsupported image path for ${product.slug}: ${product.image_url}`);
    }

    const imagePath = resolve(publicDirectory, product.image_url.slice(1));
    if (!imagePath.startsWith(publicDirectory) || !existsSync(imagePath)) {
      throw new Error(`Missing image for ${product.slug}: ${product.image_url}`);
    }
  }
}

async function updateProductImages(transaction, products) {
  const found = new Map();
  for (const spec of products) {
    const [product] = await transaction`
      select id,slug from public.products where slug=${spec.slug} for update
    `;
    if (product) found.set(spec.slug, product);
  }

  const missingSlugs = products.map(({ slug }) => slug).filter((slug) => !found.has(slug));
  if (missingSlugs.length) {
    throw new Error(`Menu image update stopped; products not found: ${missingSlugs.join(", ")}`);
  }

  for (const spec of products) {
    const productId = found.get(spec.slug).id;
    await transaction`
      update public.products set image_url=${spec.image_url},updated_at=now()
      where id=${productId}::uuid
    `;

    const images = await transaction`
      select id,is_primary from public.product_images
      where product_id=${productId}::uuid
      order by is_primary desc,sort_order,created_at,id
      for update
    `;
    if (!images.length) continue;

    const primaryImages = images.filter(({ is_primary }) => is_primary);
    const targets = primaryImages.length ? primaryImages : [images[0]];
    for (const image of targets) {
      await transaction`
        update public.product_images
        set image_url=${spec.image_url},
            is_primary=case when ${primaryImages.length === 0} then true else is_primary end
        where id=${image.id}::uuid
      `;
    }
  }

  await transaction`
    insert into public.audit_logs (
      actor_type,action,entity_type,entity_id,metadata,source_path
    ) values (
      'system',${catalog.migration_marker},'menu_images',${catalog.version},
      ${transaction.json({ updatedProducts: products.length, pricesChanged: false })},
      'scripts/apply-menu-images.mjs'
    )
  `;

  return { status: "applied", updatedProducts: products.length, pricesChanged: false };
}

validateCatalog();

if (!apply) {
  console.log(`Validated ${catalog.products.length} product images; database unchanged. Pass --apply to update photos only.`);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required when --apply is used.");
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10 });

try {
  const result = await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext(${catalog.migration_marker}))`;
    const [existingMarker] = await transaction`
      select id from public.audit_logs where action=${catalog.migration_marker} limit 1
    `;
    if (existingMarker) return { status: "already_applied", updatedProducts: 0, pricesChanged: false };

    return updateProductImages(transaction, catalog.products);
  });

  console.log(`Menu image update ${catalog.version}: ${JSON.stringify(result)}`);
} finally {
  await sql.end({ timeout: 2 });
}
