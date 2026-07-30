import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAdminActorHash, isAdminAuthenticated } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { isAllowedSameOriginRequest } from "@/lib/request-security";
import { slugifyStorageSegment, uploadImageToStorage } from "@/lib/storage-images";
import { createDatabaseServerClient } from "@/lib/database/server";

export const runtime = "nodejs";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 3 * 1024 * 1024;
const MAX_TOTAL_SIZE = 12 * 1024 * 1024;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function jsonError(message: string, status = 400, uploaded = 0) {
  return NextResponse.json({ ok: false, error: message, uploaded }, { status });
}

async function syncPrimaryProductImage(productId: string) {
  const database = createDatabaseServerClient();

  if (!database) {
    return;
  }

  const { data } = await database
    .from("product_images")
    .select("id, image_url")
    .eq("product_id", productId)
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (data) {
    await database.from("product_images").update({ is_primary: true }).eq("id", data.id);
  }

  await database.from("products").update({ image_url: data?.image_url ?? null }).eq("id", productId);
}

export async function POST(request: Request, context: RouteContext) {
  if (!isAllowedSameOriginRequest(request)) {
    return jsonError("Недопустимый источник запроса.", 403);
  }

  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    return jsonError("Нужен вход в админку.", 401);
  }

  const { id: productId } = await context.params;
  const database = createDatabaseServerClient();

  if (!database) {
    return jsonError("База данных не подключена.", 500);
  }

  const { data: product, error: productError } = await database
    .from("products")
    .select("id, slug, category")
    .eq("id", productId)
    .maybeSingle();

  if (productError || !product) {
    return jsonError("Товар не найден.", 404);
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonError("Не удалось прочитать файлы.");
  }

  const files = formData.getAll("images").filter((file): file is File => file instanceof File && file.size > 0);

  if (!files.length) {
    return jsonError("Выберите хотя бы одно фото.");
  }

  if (files.length > MAX_FILES) {
    return jsonError(`За один раз можно загрузить максимум ${MAX_FILES} фото.`);
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  if (totalSize > MAX_TOTAL_SIZE) {
    return jsonError("Общий размер файлов слишком большой. Загрузите фото несколькими подходами.");
  }

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      return jsonError("Загружайте только изображения.");
    }

    if (file.size > MAX_FILE_SIZE) {
      return jsonError(`Файл ${file.name} больше 3 MB.`);
    }
  }

  const { count } = await database
    .from("product_images")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);
  const currentCount = count ?? 0;
  const { data: primaryImage } = await database
    .from("product_images")
    .select("id")
    .eq("product_id", productId)
    .eq("is_primary", true)
    .limit(1)
    .maybeSingle();
  const category = slugifyStorageSegment(String(product.category ?? "products"));
  const slug = slugifyStorageSegment(String(product.slug ?? productId));
  let uploadedCount = 0;

  for (const [index, file] of files.entries()) {
    const uploaded = await uploadImageToStorage({
      bucket: "products",
      file,
      path: `${category}/${slug}/${Date.now()}-${currentCount + index + 1}.webp`
    });

    if (uploaded.error || !uploaded.url) {
      return jsonError(uploaded.error ?? "Не удалось загрузить фото.", 500, uploadedCount);
    }

    const { error } = await database.from("product_images").insert({
      alt: slug,
      image_url: uploaded.url,
      is_primary: !primaryImage && currentCount === 0 && index === 0,
      product_id: productId,
      sort_order: (currentCount + index + 1) * 10
    });

    if (error) {
      return jsonError("Не удалось сохранить загруженное фото.", 500, uploadedCount);
    }

    uploadedCount += 1;
  }

  await syncPrimaryProductImage(productId);
  await writeAuditLog({
    action: "product.images_upload",
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    entityId: productId,
    entityType: "product",
    metadata: { uploaded: uploadedCount },
    sourcePath: `/admin/products/${productId}/edit`
  });
  revalidatePath("/");
  revalidatePath("/menu");
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}/edit`);

  return NextResponse.json({ ok: true, uploaded: uploadedCount });
}
