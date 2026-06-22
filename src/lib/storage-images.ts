import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

type UploadImageParams = {
  bucket: "products" | "hero" | "brand";
  file: File;
  path: string;
  upsert?: boolean;
};

const maxImageSize = 8 * 1024 * 1024;

function extensionFromMime(mimeType: string) {
  if (mimeType === "image/png") {
    return "png";
  }

  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return "jpg";
  }

  if (mimeType === "image/avif") {
    return "avif";
  }

  return "webp";
}

export function slugifyStorageSegment(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "item";
}

async function prepareImage(file: File) {
  const originalBuffer = Buffer.from(await file.arrayBuffer());

  try {
    const sharp = (await import("sharp")).default;
    const buffer = await sharp(originalBuffer, { failOn: "none" })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    return {
      buffer,
      contentType: "image/webp",
      extension: "webp"
    };
  } catch {
    return {
      buffer: originalBuffer,
      contentType: file.type || "application/octet-stream",
      extension: extensionFromMime(file.type)
    };
  }
}

export async function uploadImageToStorage({ bucket, file, path, upsert = false }: UploadImageParams) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return { url: null as string | null, error: "Supabase не подключён." };
  }

  if (!(file instanceof File) || file.size === 0) {
    return { url: null as string | null, error: "Файл не выбран." };
  }

  if (!file.type.startsWith("image/")) {
    return { url: null as string | null, error: "Загрузите изображение." };
  }

  if (file.size > maxImageSize) {
    return { url: null as string | null, error: "Файл слишком большой. Максимум 8 MB." };
  }

  const prepared = await prepareImage(file);
  const normalizedPath = path.replace(/\.[a-z0-9]+$/i, `.${prepared.extension}`);
  const { error } = await supabase.storage.from(bucket).upload(normalizedPath, prepared.buffer, {
    cacheControl: "31536000",
    contentType: prepared.contentType,
    upsert
  });

  if (error) {
    return { url: null as string | null, error: error.message };
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(normalizedPath);

  return { url: data.publicUrl, error: null as string | null };
}

export async function removeStoragePublicUrl(bucket: "products" | "hero" | "brand", imageUrl: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase || !imageUrl) {
    return;
  }

  const marker = `/object/public/${bucket}/`;
  const markerIndex = imageUrl.indexOf(marker);

  if (markerIndex === -1) {
    return;
  }

  const path = decodeURIComponent(imageUrl.slice(markerIndex + marker.length).split("?")[0] ?? "");

  if (path) {
    await supabase.storage.from(bucket).remove([path]);
  }
}

