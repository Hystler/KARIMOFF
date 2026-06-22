"use client";

import { useTheme } from "./ThemeProvider";

function SunIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <circle cx="12" cy="12" r="4.4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M20.2 14.4A7.7 7.7 0 0 1 9.6 3.8 8.3 8.3 0 1 0 20.2 14.4Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Включить дневную тему" : "Включить ночную тему"}
      title={isDark ? "Дневная тема" : "Ночная тема"}
      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-karimoff-black/15 bg-white text-karimoff-black shadow-[0_10px_24px_rgba(18,18,20,0.06)] transition hover:-translate-y-0.5 hover:border-karimoff-orange hover:text-karimoff-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0 sm:h-12 sm:w-12"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
