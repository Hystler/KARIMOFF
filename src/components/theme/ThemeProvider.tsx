"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SiteTheme } from "@/lib/settings";

type ThemeContextValue = {
  theme: SiteTheme;
  toggleTheme: () => void;
};

export const THEME_STORAGE_KEY = "karimoff_theme_preference_v2";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(fallback: SiteTheme): SiteTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return fallback;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme: SiteTheme;
  forceTheme?: SiteTheme;
};

export function ThemeProvider({ children, defaultTheme, forceTheme }: ThemeProviderProps) {
  const [theme, setTheme] = useState<SiteTheme>(forceTheme ?? defaultTheme);
  const [usesSystemTheme, setUsesSystemTheme] = useState(!forceTheme);

  useEffect(() => {
    if (forceTheme) {
      document.documentElement.dataset.theme = forceTheme;
      const timeoutId = window.setTimeout(() => setTheme(forceTheme), 0);
      return () => window.clearTimeout(timeoutId);
    }

    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const hasManualTheme = savedTheme === "dark" || savedTheme === "light";
    const nextTheme = hasManualTheme ? savedTheme : getSystemTheme(defaultTheme);
    document.documentElement.dataset.theme = nextTheme;
    const timeoutId = window.setTimeout(() => {
      setTheme(nextTheme);
      setUsesSystemTheme(!hasManualTheme);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [defaultTheme, forceTheme]);

  useEffect(() => {
    if (forceTheme || !usesSystemTheme || typeof window.matchMedia !== "function") return undefined;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      const nextTheme = event.matches ? "dark" : "light";
      document.documentElement.dataset.theme = nextTheme;
      setTheme(nextTheme);
    };

    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [forceTheme, usesSystemTheme]);

  const toggleTheme = useCallback(() => {
    if (forceTheme) return;
    const nextTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    setUsesSystemTheme(false);
    setTheme(nextTheme);
  }, [forceTheme, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      toggleTheme
    }),
    [theme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }

  return context;
}
