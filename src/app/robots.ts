import type { MetadataRoute } from "next";

const PUBLIC_ORIGIN = "https://karimoff.site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/api/", "/pos", "/kitchen", "/display", "/integrations/"]
    },
    sitemap: `${PUBLIC_ORIGIN}/sitemap.xml`,
    host: PUBLIC_ORIGIN
  };
}
