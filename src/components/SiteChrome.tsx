"use client";

import { usePathname } from "next/navigation";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { CookieConsentBanner } from "./CookieConsentBanner";
import { CartDrawer } from "./cart/CartDrawer";
import { CartProvider } from "./cart/CartProvider";
import { ThemeProvider } from "./theme/ThemeProvider";
import type { SiteSettings, SiteTheme } from "@/lib/settings";

export function SiteChrome({
  children,
  defaultTheme,
  settings
}: {
  children: React.ReactNode;
  defaultTheme: SiteTheme;
  settings: SiteSettings;
}) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");

  if (isAdmin) {
    return (
      <ThemeProvider defaultTheme="light" forceTheme="light">
        {children}
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme={defaultTheme}>
      <CartProvider>
        <Header />
        {children}
        <Footer settings={settings} />
        <CartDrawer />
        <CookieConsentBanner />
      </CartProvider>
    </ThemeProvider>
  );
}
