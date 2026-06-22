import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");

const PAGE_CONTEXT_PATH = path.join(rootDir, "tmp", "juikaifui-page-context.json");
const OUTPUT_DIR = path.join(rootDir, "data", "import");
const PRODUCT_ASSET_DIR = path.join(rootDir, "public", "assets", "products");
const MAIN_URL = "https://juikaifui.ru/shelkogo/tovary";

const CATEGORY_ORDER = ["Бургеры", "Шаурма", "Хот-Доги", "Боксы", "Горячие закуски", "Напитки", "Соусы"];

const CATEGORY_FOLDER_BY_URL = {
  tovary: "burgers",
  shaurma: "shaurma",
  "hot-dogi": "hotdogs",
  boksy: "boxes",
  sneki: "snacks",
  kompot: "drinks",
  sousa: "sauces"
};

const CATEGORY_NAME_BY_URL = {
  tovary: "Бургеры",
  shaurma: "Шаурма",
  "hot-dogi": "Хот-Доги",
  boksy: "Боксы",
  sneki: "Горячие закуски",
  kompot: "Напитки",
  sousa: "Соусы"
};

const PLACEHOLDER_BY_CATEGORY = {
  "Бургеры": "/assets/products/placeholder-burger.svg",
  "Шаурма": "/assets/products/placeholder-shaurma.svg",
  "Хот-Доги": "/assets/products/placeholder-hotdog.svg",
  "Боксы": "/assets/products/placeholder-box.svg",
  "Горячие закуски": "/assets/products/placeholder-snack.svg",
  "Напитки": "/assets/products/placeholder-drink.svg",
  "Соусы": "/assets/products/placeholder-snack.svg"
};

function cleanText(value) {
  const normalized = String(value ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(", ");

  return normalized
    .replace(/\s+/g, " ")
    .replace(/Состав:\s*,\s*/i, "Состав: ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/,{2,}/g, ",")
    .replace(/\.{2,}/g, ".")
    .replace(/0,\s+/g, "0,")
    .trim();
}

function normalizeName(value) {
  return cleanText(value)
    .replace(/0,\s+/g, "0,")
    .replace(/\s+л\b/gi, " л")
    .trim();
}

function toNumber(value) {
  const number = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function sqlString(value) {
  if (value === null || value === undefined || value === "") {
    return "null";
  }

  return `'${String(value).replace(/'/g, "''")}'`;
}

function csvCell(value) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function getCategoryUrl(category) {
  return category?.seo?.friendly_url ?? "";
}

function getCategoryName(category) {
  const friendlyUrl = getCategoryUrl(category);
  return CATEGORY_NAME_BY_URL[friendlyUrl] ?? (category?.name === "Соус" ? "Соусы" : category?.name ?? "Меню");
}

function getCategoryFolder(category) {
  const friendlyUrl = getCategoryUrl(category);
  return CATEGORY_FOLDER_BY_URL[friendlyUrl] ?? "misc";
}

function getOriginalImage(product) {
  return product?.images?.large || product?.images?.medium || product?.images?.small || "";
}

function chooseBaseParameter(parameters) {
  const normalized = (parameters ?? [])
    .map((parameter, index) => ({
      ...parameter,
      index,
      price: toNumber(parameter.cost),
      oldPrice: toNumber(parameter.old_cost)
    }))
    .filter((parameter) => parameter.price > 0);

  if (!normalized.length) {
    return {
      parameter: null,
      variants: []
    };
  }

  const sorted = [...normalized].sort((left, right) => {
    if (left.price !== right.price) {
      return left.price - right.price;
    }

    return left.index - right.index;
  });

  return {
    parameter: sorted[0],
    variants: normalized
  };
}

async function readPageContext() {
  try {
    return JSON.parse(await fs.readFile(PAGE_CONTEXT_PATH, "utf8"));
  } catch {
    const response = await fetch(MAIN_URL, {
      headers: {
        "user-agent": "Mozilla/5.0 KARIMOFF import bot"
      },
      signal: AbortSignal.timeout(45000)
    });

    if (!response.ok) {
      throw new Error(`Cannot fetch ${MAIN_URL}: ${response.status}`);
    }

    const html = await response.text();
    const match = html.match(/<script id="vike_pageContext" type="application\/json">([\s\S]*?)<\/script>/);

    if (!match) {
      throw new Error("Cannot find vike_pageContext in juikaifui page");
    }

    await fs.mkdir(path.dirname(PAGE_CONTEXT_PATH), { recursive: true });
    await fs.writeFile(PAGE_CONTEXT_PATH, match[1], "utf8");
    return JSON.parse(match[1]);
  }
}

async function getSharp() {
  try {
    const mod = await import("sharp");
    return mod.default;
  } catch {
    return null;
  }
}

async function downloadImage(product, sharp) {
  if (!product.image_url_original) {
    return false;
  }

  const localPath = path.join(rootDir, "public", product.image_url_local);
  await fs.mkdir(path.dirname(localPath), { recursive: true });

  const response = await fetch(product.image_url_original, {
    headers: {
      "user-agent": "Mozilla/5.0 KARIMOFF import bot"
    },
    signal: AbortSignal.timeout(45000)
  });

  if (!response.ok) {
    throw new Error(`Image download failed for ${product.slug}: ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (sharp) {
    await sharp(bytes)
      .resize({ width: 900, withoutEnlargement: true })
      .webp({ quality: 84 })
      .toFile(localPath);
  } else {
    await fs.writeFile(localPath, bytes);
  }

  return true;
}

function buildProducts(pageContext) {
  const store = pageContext.initialStoreState ?? {};
  const categories = store.categories?.all ?? [];
  const rawProducts = store.products?.all ?? [];
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const sourceIndexByProductId = new Map(rawProducts.map((product, index) => [product.id, index]));
  const usedSlugs = new Set();
  const modifiers = [];
  const duplicateSlugs = [];

  const products = rawProducts
    .map((product) => {
      const category = categoriesById.get(product.category_id);
      const categoryName = getCategoryName(category);
      const folder = getCategoryFolder(category);
      const { parameter, variants } = chooseBaseParameter(product.parameters);
      const sourceSlug = product.seo?.friendly_url || String(product.id);
      let slug = sourceSlug;

      if (usedSlugs.has(slug)) {
        duplicateSlugs.push(slug);
        slug = `${slug}-${product.id}`;
      }

      usedSlugs.add(slug);

      if (variants.length > 1) {
        modifiers.push({
          name: normalizeName(product.name),
          slug,
          category: categoryName,
          selected: parameter?.description ?? "",
          variants: variants.map((variant) => ({
            unit: cleanText(variant.description),
            price: variant.price,
            old_price: variant.oldPrice || null
          }))
        });
      }

      const imageOriginal = getOriginalImage(product);
      const imageLocal = imageOriginal ? `/assets/products/${folder}/${slug}.webp` : "";
      const productUrl = `https://juikaifui.ru/shelkogo/${getCategoryUrl(category)}/${sourceSlug}`;

      return {
        source_id: String(product.id),
        category: categoryName,
        name: normalizeName(product.name),
        slug,
        description: cleanText(product.description),
        unit: cleanText(parameter?.description ?? ""),
        price: parameter?.price ?? 0,
        old_price: parameter?.oldPrice || null,
        product_url: productUrl,
        image_url_original: imageOriginal,
        image_url_local: imageLocal,
        is_active: true,
        source_published: product.published !== false,
        sort_order: 0,
        source_category_url: getCategoryUrl(category),
        source_order: sourceIndexByProductId.get(product.id) ?? 0,
        modifiers: variants.map((variant) => ({
          unit: cleanText(variant.description),
          price: variant.price,
          old_price: variant.oldPrice || null
        }))
      };
    })
    .sort((left, right) => {
      const leftCategoryIndex = CATEGORY_ORDER.indexOf(left.category);
      const rightCategoryIndex = CATEGORY_ORDER.indexOf(right.category);
      const normalizedLeftCategory = leftCategoryIndex === -1 ? 999 : leftCategoryIndex;
      const normalizedRightCategory = rightCategoryIndex === -1 ? 999 : rightCategoryIndex;

      if (normalizedLeftCategory !== normalizedRightCategory) {
        return normalizedLeftCategory - normalizedRightCategory;
      }

      return left.source_order - right.source_order;
    })
    .map((product, index) => ({
      ...product,
      sort_order: index + 1
    }));

  return {
    products,
    categories,
    modifiers,
    duplicateSlugs
  };
}

function buildCsv(products) {
  const headers = [
    "category",
    "name",
    "slug",
    "description",
    "unit",
    "price",
    "old_price",
    "product_url",
    "image_url_original",
    "image_url_local",
    "is_active",
    "sort_order"
  ];

  return [
    headers.join(","),
    ...products.map((product) => headers.map((header) => csvCell(product[header])).join(","))
  ].join("\n");
}

function buildSql(products) {
  const rows = products
    .map((product) => {
      const description = product.description || (product.unit ? `Порция: ${product.unit}` : null);
      return [
        sqlString(product.slug),
        sqlString(product.name),
        sqlString(product.category),
        sqlString(description),
        product.price.toFixed(2),
        sqlString(product.image_url_local || PLACEHOLDER_BY_CATEGORY[product.category] || null),
        product.is_active ? "true" : "false",
        String(product.sort_order),
        sqlString(product.unit || null)
      ].join(", ");
    })
    .map((row) => `  (${row})`)
    .join(",\n");

  const slugList = products.map((product) => sqlString(product.slug)).join(", ");

  return `-- Seed generated from juikaifui.ru menu.\n-- Run supabase/products.sql before this seed if the products table is not created yet.\n\ninsert into public.products (\n  slug,\n  name,\n  category,\n  description,\n  price,\n  image_url,\n  is_active,\n  sort_order,\n  weight\n) values\n${rows}\non conflict (slug) do update set\n  name = excluded.name,\n  category = excluded.category,\n  description = excluded.description,\n  price = excluded.price,\n  image_url = excluded.image_url,\n  is_active = excluded.is_active,\n  sort_order = excluded.sort_order,\n  weight = excluded.weight,\n  updated_at = now();\n\n-- Optional manual cleanup for old demo placeholder products after you verify this import:\n-- update public.products\n-- set is_active = false, updated_at = now()\n-- where image_url like '/assets/products/placeholder-%'\n--   and slug not in (${slugList});\n`;
}

function buildReport({ products, categories, modifiers, duplicateSlugs, downloadedCount, imageErrors }) {
  const categoryLines = CATEGORY_ORDER
    .filter((category) => products.some((product) => product.category === category))
    .map((category) => {
      const count = products.filter((product) => product.category === category).length;
      return `- ${category}: ${count}`;
    });

  const noImageProducts = products.filter((product) => !product.image_url_local);
  const noImageLines = noImageProducts.length
    ? noImageProducts.map((product) => `- ${product.name} (${product.slug})`)
    : ["- Нет"];

  const modifierLines = modifiers.length
    ? modifiers.map((item) => {
        const variants = item.variants.map((variant) => `${variant.unit} — ${variant.price} ₽`).join("; ");
        return `- ${item.name} (${item.slug}): взят базовый вариант «${item.selected}». Варианты: ${variants}.`;
      })
    : ["- Нет"];

  const duplicateLines = duplicateSlugs.length ? duplicateSlugs.map((slug) => `- ${slug}`) : ["- Не найдено"];
  const imageErrorLines = imageErrors.length
    ? imageErrors.map((error) => `- ${error.slug}: ${error.message}`)
    : ["- Нет"];
  const sourceCategories = categories.map((category) => `- ${category.name} (${category.seo?.friendly_url ?? "без URL"})`);

  return `# Juikaifui menu scrape report\n\nИсточник: ${MAIN_URL}\n\n## Итоги\n\n- Категорий в исходном состоянии сайта: ${categories.length}\n- Категорий импортировано: ${categoryLines.length}\n- Товаров собрано: ${products.length}\n- Фото скачано: ${downloadedCount}\n- Ошибок скачивания фото: ${imageErrors.length}\n\n## Категории\n\n${categoryLines.join("\n")}\n\n## Категории в исходнике\n\n${sourceCategories.join("\n")}\n\n## Товары без фото\n\n${noImageLines.join("\n")}\n\n## Спорные цены и модификаторы\n\n${modifierLines.join("\n")}\n\n## Возможные дубли slug\n\n${duplicateLines.join("\n")}\n\n## Ошибки изображений\n\n${imageErrorLines.join("\n")}\n\n## Примечания\n\n- Данные взяты из браузерно загруженного состояния страницы 'vike_pageContext', где сайт хранит категории и товары.\n- Для товаров с несколькими модификаторами в seed выбран самый дешевый базовый вариант; остальные варианты сохранены в JSON/CSV и перечислены выше.\n- 'old_price', 'product_url' и 'image_url_original' сохранены в JSON/CSV для контроля, но не пишутся в 'products', потому что текущая таблица проекта их не содержит.\n- Seed не удаляет и не отключает старые товары автоматически. В конце SQL есть закомментированный optional cleanup для старых placeholder-позиций.\n`;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(PRODUCT_ASSET_DIR, { recursive: true });

  const pageContext = await readPageContext();
  const { products, categories, modifiers, duplicateSlugs } = buildProducts(pageContext);
  const sharp = await getSharp();
  const imageErrors = [];
  let downloadedCount = 0;

  for (const product of products) {
    if (!product.image_url_original) {
      continue;
    }

    try {
      const downloaded = await downloadImage(product, sharp);

      if (downloaded) {
        downloadedCount += 1;
      }
    } catch (error) {
      imageErrors.push({
        slug: product.slug,
        message: error instanceof Error ? error.message : String(error)
      });
      product.image_url_local = "";
    }
  }

  await fs.writeFile(path.join(OUTPUT_DIR, "juikaifui-products.json"), `${JSON.stringify(products, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(OUTPUT_DIR, "juikaifui-products.csv"), `${buildCsv(products)}\n`, "utf8");

  const sql = buildSql(products);
  await fs.writeFile(path.join(rootDir, "supabase", "seed-products-from-juikaifui.sql"), sql, "utf8");
  await fs.writeFile(path.join(rootDir, "supabase", "seed-products.sql"), sql, "utf8");
  await fs.writeFile(
    path.join(OUTPUT_DIR, "juikaifui-scrape-report.md"),
    buildReport({ products, categories, modifiers, duplicateSlugs, downloadedCount, imageErrors }),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        categories: CATEGORY_ORDER.filter((category) => products.some((product) => product.category === category)).length,
        products: products.length,
        downloadedImages: downloadedCount,
        imageErrors: imageErrors.length,
        modifiers: modifiers.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
