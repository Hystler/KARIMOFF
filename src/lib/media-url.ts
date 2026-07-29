import "server-only";

const supabasePublicObjectMarker = "/storage/v1/object/public/";

function trimTrailingSlash(value: string | undefined) {
  return value?.trim().replace(/\/+$/, "") || null;
}

export function getPublicMediaBaseUrl() {
  return trimTrailingSlash(process.env.S3_CDN_BASE_URL) ?? trimTrailingSlash(process.env.S3_PUBLIC_BASE_URL);
}

export function resolvePublicMediaUrl(value: string | null) {
  if (!value || process.env.STORAGE_PROVIDER !== "s3") {
    return value;
  }

  const publicBaseUrl = getPublicMediaBaseUrl();

  if (!publicBaseUrl) {
    return value;
  }

  try {
    const url = new URL(value);
    const markerIndex = url.pathname.indexOf(supabasePublicObjectMarker);

    if (!url.hostname.endsWith(".supabase.co") || markerIndex === -1) {
      return value;
    }

    const storagePath = url.pathname.slice(markerIndex + supabasePublicObjectMarker.length);
    return `${publicBaseUrl}/${storagePath
      .split("/")
      .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
      .join("/")}`;
  } catch {
    return value;
  }
}
