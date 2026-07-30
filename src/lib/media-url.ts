import "server-only";

function trimTrailingSlash(value: string | undefined) {
  return value?.trim().replace(/\/+$/, "") || null;
}

export function getPublicMediaBaseUrl() {
  return trimTrailingSlash(process.env.S3_CDN_BASE_URL) ?? trimTrailingSlash(process.env.S3_PUBLIC_BASE_URL);
}

export function resolvePublicMediaUrl(value: string | null) {
  if (!value) {
    return value;
  }

  const originBaseUrl = trimTrailingSlash(process.env.S3_PUBLIC_BASE_URL);
  const publicBaseUrl = trimTrailingSlash(process.env.S3_CDN_BASE_URL);

  if (!originBaseUrl || !publicBaseUrl || !value.startsWith(`${originBaseUrl}/`)) {
    return value;
  }

  return `${publicBaseUrl}${value.slice(originBaseUrl.length)}`;
}
