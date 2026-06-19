"use client";

import { usePathname } from "next/navigation";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { CartDrawer } from "./cart/CartDrawer";
import { CartProvider } from "./cart/CartProvider";
import { ThemeProvider } from "./theme/ThemeProvider";
import type { SiteTheme } from "@/lib/settings";

export function SiteChrome({ children, defaultTheme }: { children: React.ReactNode; defaultTheme: SiteTheme }) {
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
        <Footer />
        <CartDrawer />
      </CartProvider>
    </ThemeProvider>
  );
}
