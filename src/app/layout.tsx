import type { Metadata } from "next";
import { Manrope, Rubik } from "next/font/google";
import { SiteChrome } from "@/components/SiteChrome";
import { getSiteSettings } from "@/lib/settings";
import "./globals.css";

export const metadata: Metadata = {
  title: "KARIMOFF | Бургерная",
  description:
    "KARIMOFF — бургерная с ресторанным вкусом по цене обычного перекуса.",
  metadataBase: new URL("https://karimoff.site"),
  alternates: { canonical: "/" }
};

export const dynamic = "force-dynamic";

const manrope = Manrope({
  subsets: ["cyrillic", "latin"],
  variable: "--font-manrope",
  display: "swap"
});

const rubik = Rubik({
  subsets: ["cyrillic", "latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-rubik",
  display: "swap"
});

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getSiteSettings();
  const themeBootstrap = `(() => { try { const saved = localStorage.getItem("karimoff_theme_preference_v2"); const theme = saved === "dark" || saved === "light" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; document.documentElement.dataset.theme = theme; } catch { document.documentElement.dataset.theme = ${JSON.stringify(settings.theme)}; } })();`;

  return (
    <html lang="ru" data-scroll-behavior="smooth" className={`${manrope.variable} ${rubik.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <SiteChrome
          defaultTheme={settings.theme}
          maintenanceMode={process.env.MAINTENANCE_MODE === "true"}
          settings={settings}
        >
          {children}
        </SiteChrome>
      </body>
    </html>
  );
}
