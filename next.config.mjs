import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

function httpsMediaPattern(value) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;

    return {
      hostname: url.hostname,
      pathname: `${url.pathname.replace(/\/+$/, "") || ""}/**`,
      port: url.port,
      protocol: "https"
    };
  } catch {
    return null;
  }
}

const cdnPattern = httpsMediaPattern(process.env.S3_CDN_BASE_URL);
const storagePattern = httpsMediaPattern(process.env.S3_PUBLIC_BASE_URL);
const mediaOrigins = [
  "https://s3.twcstorage.ru",
  storagePattern ? `https://${storagePattern.hostname}${storagePattern.port ? `:${storagePattern.port}` : ""}` : null,
  cdnPattern ? `https://${cdnPattern.hostname}${cdnPattern.port ? `:${cdnPattern.port}` : ""}` : null
].filter(Boolean);

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${mediaOrigins.join(" ")}`,
  "font-src 'self' data:",
  "connect-src 'self'",
  `media-src 'self' ${mediaOrigins.join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests"
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb"
    }
  },
  images: {
    formats: ["image/webp"],
    imageSizes: [128, 192, 256, 320, 384, 480, 512],
    minimumCacheTTL: 2678400,
    remotePatterns: [
      {
        hostname: "s3.twcstorage.ru",
        protocol: "https"
      },
      ...(storagePattern ? [storagePattern] : []),
      ...(cdnPattern ? [cdnPattern] : [])
    ]
  },
  outputFileTracingRoot: __dirname,
  async headers() {
    const securityHeaders = [
      { key: "Content-Security-Policy", value: contentSecurityPolicy },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-DNS-Prefetch-Control", value: "off" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" }
    ];

    if (isProduction) {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains"
      });
    }

    return [
      {
        source: "/assets/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }]
      },
      { source: "/(.*)", headers: securityHeaders }
    ];
  }
};

export default nextConfig;
