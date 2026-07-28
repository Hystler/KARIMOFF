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
  const activeLabel = options.base.find((option) => option.value === avatar.base)?.label ?? "KARIMOFF";

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
    <div className="relative left-1/2 w-screen -translate-x-1/2 overflow-hidden border-y border-black/10 bg-karimoff-black">
      <div className="grid min-h-[680px] lg:grid-cols-[minmax(0,1fr)_430px]">
        <section className="relative min-h-[520px] lg:min-h-[680px]">
          <Avatar3DStudio avatar={avatar} />
          <div className="pointer-events-none absolute left-5 top-5 z-10 max-w-[75%] text-white sm:left-8 sm:top-8">
            <p className="text-xs font-black uppercase text-karimoff-orange">KARIMOFF Avatar 2.0</p>
            <h2 className="mt-2 text-2xl font-black leading-tight sm:text-4xl">{activeLabel}</h2>
            <p className="mt-2 hidden max-w-md text-sm leading-6 text-white/68 sm:block">
              Живой 3D-персонаж. Поверните его и рассмотрите образ со всех сторон.
            </p>
          </div>
        </section>

        <form action={saveAvatarAction} className="flex min-w-0 flex-col bg-[#F7F4EF] text-karimoff-black">
          {sections.map((section) => (
            <input key={section.key} type="hidden" name={section.key} value={avatar[section.key]} />
          ))}

          <div className="border-b border-karimoff-line px-5 pb-4 pt-5 sm:px-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase text-karimoff-orange">Редактор образа</p>
                <h3 className="mt-1 text-xl font-black">Соберите персонажа</h3>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAvatar(initialAvatar)}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-karimoff-line bg-white text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange"
                  aria-label="Вернуть сохранённый образ"
                  title="Вернуть сохранённый образ"
                >
                  <RotateCcw size={18} />
                </button>
                <button
                  type="button"
                  onClick={shuffleAvatar}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-karimoff-orange bg-karimoff-orange text-white shadow-[0_10px_24px_rgba(251,103,10,0.22)] transition hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange"
                  aria-label="Случайный образ"
                  title="Случайный образ"
                >
                  <Shuffle size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto border-b border-karimoff-line px-3 py-3">
            <div className="flex min-w-max gap-1">
              {sections.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.key;
                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => setActiveSection(section.key)}
                    className={`flex min-h-12 items-center gap-2 rounded-md px-3 text-xs font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange ${
                      isActive ? "bg-karimoff-black text-white" : "text-karimoff-muted hover:bg-white hover:text-karimoff-black"
                    }`}
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
                    className={`min-h-[76px] rounded-lg border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange ${
                      isSelected
                        ? "border-karimoff-orange bg-white shadow-[0_12px_28px_rgba(18,18,20,0.08)]"
                        : "border-karimoff-line bg-white/55 hover:border-karimoff-black/25 hover:bg-white"
                    }`}
                    aria-pressed={isSelected}
                  >
                    <span className="flex items-center gap-2">
                      {color ? (
                        <span
                          className="h-5 w-5 shrink-0 rounded-full border border-black/10"
                          style={{ backgroundColor: color }}
                        />
                      ) : (
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${isSelected ? "bg-karimoff-orange" : "bg-karimoff-line"}`} />
                      )}
                      <span className="text-sm font-bold leading-5">{option.label}</span>
                    </span>
                    {isSelected ? <span className="mt-2 block text-xs font-semibold text-karimoff-orange">Выбрано</span> : null}
                  </button>
                );
              })}
            </div>

            {error ? (
              <p className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="sticky bottom-0 border-t border-karimoff-line bg-[#F7F4EF]/95 p-5 backdrop-blur-md sm:p-6">
            <button
              type="submit"
              className="min-h-12 w-full rounded-full border border-karimoff-orange bg-karimoff-orange px-7 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.22)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
            >
              Сохранить персонажа
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
