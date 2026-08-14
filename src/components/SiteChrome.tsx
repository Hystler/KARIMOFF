"use client";

import { usePathname } from "next/navigation";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { CookieConsentBanner } from "./CookieConsentBanner";
import { CartDrawer } from "./cart/CartDrawer";
import { CartProvider } from "./cart/CartProvider";
import { MaintenanceBanner } from "./MaintenanceBanner";
import { ThemeProvider } from "./theme/ThemeProvider";
import type { SiteSettings, SiteTheme } from "@/lib/settings";

export function SiteChrome({
  children,
  defaultTheme,
  maintenanceMode,
  settings
}: {
  children: React.ReactNode;
  defaultTheme: SiteTheme;
  maintenanceMode: boolean;
  settings: SiteSettings;
}) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");
  const isOperational = pathname === "/pos" || pathname.startsWith("/kitchen") || pathname.startsWith("/display");

  if (isAdmin || isOperational) {
    return (
      <ThemeProvider defaultTheme="light" forceTheme="light">
        <div className="admin-root min-h-screen">{children}</div>
        {maintenanceMode ? <MaintenanceBanner /> : null}
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
        {maintenanceMode ? <MaintenanceBanner /> : null}
      </CartProvider>
    </ThemeProvider>
  );
}
