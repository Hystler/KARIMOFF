import "server-only";

import { createHash } from "node:crypto";
import { removeS3Object, s3KeyFromPublicUrl, uploadS3Object } from "@/lib/s3/server";

type UploadImageParams = {
  bucket: "products" | "hero" | "brand";
  file: File;
  path: string;
  upsert?: boolean;
};

const bucketImageLimits = {
  brand: 5 * 1024 * 1024,
  hero: 5 * 1024 * 1024,
  products: 3 * 1024 * 1024
} satisfies Record<UploadImageParams["bucket"], number>;

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

export async function uploadImageToStorage({ bucket, file, path }: UploadImageParams) {
  if (!(file instanceof File) || file.size === 0) {
    return { url: null as string | null, error: "Файл не выбран." };
  }

  if (!file.type.startsWith("image/")) {
    return { url: null as string | null, error: "Загрузите изображение." };
  }

  if (file.size > bucketImageLimits[bucket]) {
    const limitMb = bucketImageLimits[bucket] / 1024 / 1024;
    return { url: null as string | null, error: `Файл слишком большой. Максимум ${limitMb} MB.` };
  }

  const prepared = await prepareImage(file);
  const normalizedPath = path.replace(/\.[a-z0-9]+$/i, `.${prepared.extension}`);
  const contentHash = createHash("sha256").update(prepared.buffer).digest("hex").slice(0, 12);
  const versionedPath = normalizedPath.replace(
    new RegExp(`\\.${prepared.extension}$`, "i"),
    `-${contentHash}.${prepared.extension}`
  );

  return uploadS3Object(`${bucket}/${versionedPath}`, prepared.buffer, prepared.contentType);
}

export async function removeStoragePublicUrl(bucket: "products" | "hero" | "brand", imageUrl: string) {
  void bucket;
  const key = s3KeyFromPublicUrl(imageUrl);
  if (key) await removeS3Object(key);
}
