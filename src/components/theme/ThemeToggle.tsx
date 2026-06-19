"use client";

import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Включить дневную тему" : "Включить ночную тему"}
      className="inline-flex h-12 min-w-12 items-center justify-center rounded-full border border-karimoff-black/15 bg-white px-3 text-sm font-black text-karimoff-black shadow-[0_10px_24px_rgba(18,18,20,0.06)] transition hover:-translate-y-0.5 hover:border-karimoff-orange hover:text-karimoff-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
    >
      {isDark ? "День" : "Ночь"}
    </button>
  );
}
