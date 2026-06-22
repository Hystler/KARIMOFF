"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ProductImageUploadFormProps = {
  productId: string;
};

const MAX_FILES = 5;
const MAX_FILE_SIZE = 3 * 1024 * 1024;

function checkImageDimensions(file: File) {
  return new Promise<string | null>((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const ratio = image.naturalWidth / image.naturalHeight;
      URL.revokeObjectURL(objectUrl);

      if (image.naturalWidth < 900 || image.naturalHeight < 900) {
        resolve(`${file.name}: фото меньше 1200×1200, может выглядеть мягко на больших экранах.`);
        return;
      }

      if (ratio < 0.65 || ratio > 1.45) {
        resolve(`${file.name}: фото сильно отличается от квадрата или 4:3, проверьте кадрирование.`);
        return;
      }

      resolve(null);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(`${file.name}: не удалось проверить размер изображения.`);
    };

    image.src = objectUrl;
  });
}

export function ProductImageUploadForm({ productId }: ProductImageUploadFormProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const nextWarnings: string[] = [];

    if (files.length > MAX_FILES) {
      nextWarnings.push(`За один раз можно загрузить максимум ${MAX_FILES} фото.`);
    }

    for (const file of files.slice(0, MAX_FILES)) {
      if (file.size > MAX_FILE_SIZE) {
        nextWarnings.push(`${file.name}: файл больше 3 MB.`);
        continue;
      }

      const warning = await checkImageDimensions(file);

      if (warning) {
        nextWarnings.push(warning);
      }
    }

    setWarnings(nextWarnings);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const files = Array.from(inputRef.current?.files ?? []);

    if (!files.length) {
      setMessage("Выберите хотя бы одно фото.");
      return;
    }

    if (files.length > MAX_FILES) {
      setMessage(`За один раз можно загрузить максимум ${MAX_FILES} фото.`);
      return;
    }

    const formData = new FormData();
    files.forEach((file) => formData.append("images", file));
    setIsUploading(true);

    try {
      const response = await fetch(`/api/admin/products/${productId}/images`, {
        body: formData,
        method: "POST"
      });
      const result = (await response.json()) as { error?: string; ok?: boolean; uploaded?: number };

      if (!response.ok || !result.ok) {
        setMessage(result.error ?? "Не удалось загрузить фото.");
        return;
      }

      setMessage(`Загружено фото: ${result.uploaded ?? files.length}.`);
      setWarnings([]);

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      router.refresh();
    } catch {
      setMessage("Не удалось загрузить фото. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 grid gap-3 rounded-xl border border-dashed border-karimoff-line bg-karimoff-cream/70 p-4">
      <label className="grid gap-2 text-sm font-semibold">
        Загрузить фото
        <input
          ref={inputRef}
          name="images"
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="rounded-xl border border-karimoff-line bg-white px-4 py-3 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-karimoff-orange file:px-4 file:py-2 file:text-sm file:font-bold file:text-white"
        />
      </label>
      {warnings.length ? (
        <div className="grid gap-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-800">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-karimoff-line bg-white px-4 py-3 text-sm font-semibold text-karimoff-muted">
          {message}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={isUploading}
        className="w-fit rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.18)] transition hover:-translate-y-0.5 hover:bg-[#D95405] disabled:translate-y-0 disabled:opacity-60"
      >
        {isUploading ? "Загружаем..." : "Добавить фото"}
      </button>
    </form>
  );
}
