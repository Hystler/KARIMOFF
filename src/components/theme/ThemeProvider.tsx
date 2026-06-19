"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SiteTheme } from "@/lib/settings";

type ThemeContextValue = {
  theme: SiteTheme;
  toggleTheme: () => void;
};

const THEME_STORAGE_KEY = "karimoff_theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme: SiteTheme;
  forceTheme?: SiteTheme;
};

export function ThemeProvider({ children, defaultTheme, forceTheme }: ThemeProviderProps) {
  const [theme, setTheme] = useState<SiteTheme>(forceTheme ?? defaultTheme);

  useEffect(() => {
    if (forceTheme) {
      document.documentElement.dataset.theme = forceTheme;
      const timeoutId = window.setTimeout(() => setTheme(forceTheme), 0);
      return () => window.clearTimeout(timeoutId);
    }

    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const nextTheme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : defaultTheme;
    document.documentElement.dataset.theme = nextTheme;
    const timeoutId = window.setTimeout(() => setTheme(nextTheme), 0);

    return () => window.clearTimeout(timeoutId);
  }, [defaultTheme, forceTheme]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;

    if (!forceTheme) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }, [forceTheme, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark"))
    }),
    [theme]
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
