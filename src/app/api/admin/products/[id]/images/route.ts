import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { slugifyStorageSegment, uploadImageToStorage } from "@/lib/storage-images";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const { data } = await supabase
    .from("product_images")
    .select("id, image_url")
    .eq("product_id", productId)
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (data) {
    await supabase.from("product_images").update({ is_primary: true }).eq("id", data.id);
  }

  await supabase.from("products").update({ image_url: data?.image_url ?? null }).eq("id", productId);
}

export async function POST(request: Request, context: RouteContext) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    return jsonError("Нужен вход в админку.", 401);
  }

  const { id: productId } = await context.params;
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return jsonError("Supabase не подключён.", 500);
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, slug, category")
    .eq("id", productId)
    .maybeSingle();

  if (productError || !product) {
    return jsonError(productError?.message ?? "Товар не найден.", 404);
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

  const { count } = await supabase
    .from("product_images")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);
  const currentCount = count ?? 0;
  const { data: primaryImage } = await supabase
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

    const { error } = await supabase.from("product_images").insert({
      alt: slug,
      image_url: uploaded.url,
      is_primary: !primaryImage && currentCount === 0 && index === 0,
      product_id: productId,
      sort_order: (currentCount + index + 1) * 10
    });

    if (error) {
      return jsonError(error.message, 500, uploadedCount);
    }

    uploadedCount += 1;
  }

  await syncPrimaryProductImage(productId);
  revalidatePath("/");
  revalidatePath("/menu");
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}/edit`);

  return NextResponse.json({ ok: true, uploaded: uploadedCount });
}
