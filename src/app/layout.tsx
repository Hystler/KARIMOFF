import type { Metadata } from "next";
import { Manrope, Rubik } from "next/font/google";
import { SiteChrome } from "@/components/SiteChrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "KARIMOFF | Premium fast food",
  description:
    "KARIMOFF — premium fast food бренд с ресторанным вкусом по цене обычного перекуса.",
  metadataBase: new URL("https://karimoff.vercel.app")
};

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

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" data-scroll-behavior="smooth" className={`${manrope.variable} ${rubik.variable}`}>
      <body>
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
