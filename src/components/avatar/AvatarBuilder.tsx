"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, type ComponentType } from "react";
import { CircleUserRound, Eye, Glasses, Image, RotateCcw, Shirt, Shuffle, Smile } from "lucide-react";
import { saveAvatarAction } from "@/app/profile/avatar/actions";
import { avatarOptions, type AvatarConfig, type AvatarOptions } from "@/lib/avatar-schema";

const Avatar3DStudio = dynamic(
  () => import("./Avatar3DStudio").then((module) => module.Avatar3DStudio),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[430px] items-center justify-center bg-[#171719] text-sm font-semibold text-white/70">
        Собираем 3D-студию…
      </div>
    )
  }
);

type AvatarBuilderProps = {
  initialAvatar: AvatarConfig;
  options?: AvatarOptions;
  error?: string | null;
};

type EditableAvatarKey = keyof AvatarConfig;

const sections: Array<{
  key: EditableAvatarKey;
  label: string;
  icon: ComponentType<{ size?: number }>;
}> = [
  { key: "base", label: "Типаж", icon: CircleUserRound },
  { key: "eyes", label: "Взгляд", icon: Eye },
  { key: "mouth", label: "Характер", icon: Smile },
  { key: "accessory", label: "Аксессуар", icon: Glasses },
  { key: "clothes", label: "Образ", icon: Shirt },
  { key: "background", label: "Сцена", icon: Image }
];

const optionColors: Record<string, string> = {
  studio_orange: "#FB670A",
  night_city: "#121214",
  kitchen_line: "#5B5B60",
  clean: "#F1ECE5",
  varsity_orange: "#FB670A",
  black_hoodie: "#242427",
  chef_jacket: "#F4F1EC",
  utility_black: "#121214"
};

function randomIndex(length: number) {
  if (length <= 1) return 0;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % length;
}

export function AvatarBuilder({ initialAvatar, options = avatarOptions, error }: AvatarBuilderProps) {
  const [avatar, setAvatar] = useState<AvatarConfig>(initialAvatar);
  const [activeSection, setActiveSection] = useState<EditableAvatarKey>("base");
  const activeOptions = useMemo(() => {
    const currentValue = avatar[activeSection];
    return options[activeSection].some((option) => option.value === currentValue)
      ? options[activeSection]
      : [{ value: currentValue, label: `Текущий вариант` }, ...options[activeSection]];
  }, [activeSection, avatar, options]);
  function shuffleAvatar() {
    setAvatar(
      sections.reduce((next, section) => {
        const sectionOptions = options[section.key];
        if (sectionOptions.length) {
          next[section.key] = sectionOptions[randomIndex(sectionOptions.length)].value;
        }
        return next;
      }, { ...avatar })
    );
  }

  return (
    <div className="avatar-editor profile-border w-full overflow-clip border-y bg-karimoff-black">
      <div className="grid min-h-[620px] lg:grid-cols-[minmax(0,1fr)_430px]">
        <section className="relative min-w-0 min-h-[480px] lg:min-h-[620px]">
          <Avatar3DStudio avatar={avatar} />
        </section>

        <form action={saveAvatarAction} className="avatar-editor-panel flex min-w-0 flex-col">
          {sections.map((section) => (
            <input key={section.key} type="hidden" name={section.key} value={avatar[section.key]} />
          ))}

          <div className="profile-border border-b px-5 pb-4 pt-5 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 flex-1 basis-40">
                <p className="profile-accent text-xs font-black uppercase">Редактор образа</p>
                <h3 className="mt-1 text-xl font-black">Соберите персонажа</h3>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setAvatar(initialAvatar)}
                  className="public-icon-button h-11 w-11 sm:h-11 sm:w-11"
                  aria-label="Вернуть сохранённый образ"
                  title="Вернуть сохранённый образ"
                >
                  <RotateCcw size={18} />
                </button>
                <button
                  type="button"
                  onClick={shuffleAvatar}
                  className="public-button-primary h-11 min-h-11 w-11 shrink-0 px-0 py-0"
                  aria-label="Случайный образ"
                  title="Случайный образ"
                >
                  <Shuffle size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="profile-border border-b p-3">
            <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }} role="group" aria-label="Разделы редактора">
              {sections.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.key;
                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => setActiveSection(section.key)}
                    className="avatar-section flex min-h-16 min-w-0 flex-col items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-bold transition min-[400px]:min-h-12 min-[400px]:flex-row"
                    aria-pressed={isActive}
                  >
                    <Icon size={17} />
                    {section.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 p-5 sm:p-6">
            <p className="text-sm font-black">{sections.find((section) => section.key === activeSection)?.label}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {activeOptions.map((option) => {
                const isSelected = avatar[activeSection] === option.value;
                const color = optionColors[option.value];
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAvatar((current) => ({ ...current, [activeSection]: option.value }))}
                    className="avatar-option min-h-[104px] min-w-0 rounded-lg border p-3 text-left transition"
                    aria-pressed={isSelected}
                  >
                    <span className="flex min-h-10 items-center gap-2">
                      {color ? (
                        <span
                          className="avatar-swatch h-5 w-5 shrink-0 rounded-full border"
                          style={{ backgroundColor: color }}
                          aria-hidden="true"
                        />
                      ) : (
                        <span className="avatar-option-dot h-2.5 w-2.5 shrink-0 rounded-full" aria-hidden="true" />
                      )}
                      <span className="min-w-0 [overflow-wrap:anywhere] text-sm font-bold leading-5">{option.label}</span>
                    </span>
                    <span className="profile-accent mt-2 block min-h-4 text-xs font-semibold" aria-hidden="true">{isSelected ? "Выбрано" : null}</span>
                  </button>
                );
              })}
            </div>

            {error ? (
              <p className="profile-error mt-5 rounded-lg border px-4 py-3 text-sm font-semibold" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="avatar-editor-footer profile-border border-t p-5 sm:p-6">
            <button
              type="submit"
              className="public-button-primary w-full px-7"
            >
              Сохранить персонажа
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
