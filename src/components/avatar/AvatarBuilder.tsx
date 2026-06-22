"use client";

import { useState } from "react";
import { saveAvatarAction } from "@/app/profile/avatar/actions";
import { avatarOptions, type AvatarConfig, type AvatarOptions } from "@/lib/avatar-schema";
import { AvatarPreview } from "./AvatarPreview";

type AvatarBuilderProps = {
  initialAvatar: AvatarConfig;
  options?: AvatarOptions;
  error?: string | null;
};

type EditableAvatarKey = keyof AvatarConfig;

const sections: Array<{ key: EditableAvatarKey; label: string }> = [
  { key: "base", label: "Основа" },
  { key: "eyes", label: "Глаза" },
  { key: "mouth", label: "Рот" },
  { key: "accessory", label: "Аксессуар" },
  { key: "clothes", label: "Одежда" },
  { key: "background", label: "Фон" }
];

export function AvatarBuilder({ initialAvatar, options = avatarOptions, error }: AvatarBuilderProps) {
  const [avatar, setAvatar] = useState<AvatarConfig>(initialAvatar);

  return (
    <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
      <section className="rounded-[1.5rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.10)]">
        <p className="text-sm font-semibold text-karimoff-orange">Preview</p>
        <div className="mt-6 flex justify-center">
          <AvatarPreview avatar={avatar} size="lg" />
        </div>
        <p className="mt-6 text-sm leading-6 text-karimoff-muted">
          Чёрно-белая панда KARIMOFF с аккуратными оранжевыми деталями. Без загрузок фото и лишних эффектов.
        </p>
      </section>

      <form action={saveAvatarAction} className="rounded-[1.5rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.10)]">
        <div className="grid gap-5">
          {sections.map((section) => {
            const currentValue = avatar[section.key];
            const sectionOptions = options[section.key].some((option) => option.value === currentValue)
              ? options[section.key]
              : [{ value: currentValue, label: `Текущее: ${currentValue}` }, ...options[section.key]];

            return (
              <label key={section.key} className="grid gap-2 text-sm font-semibold text-karimoff-black">
                {section.label}
                <select
                  name={section.key}
                  value={currentValue}
                  onChange={(event) => setAvatar((current) => ({ ...current, [section.key]: event.target.value }))}
                  className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]"
                >
                  {sectionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>

        {error ? (
          <p className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="mt-6 rounded-full border border-karimoff-orange bg-karimoff-orange px-7 py-4 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.22)] transition hover:-translate-y-0.5 hover:bg-[#D95405]"
        >
          Сохранить аватар
        </button>
      </form>
    </div>
  );
}
