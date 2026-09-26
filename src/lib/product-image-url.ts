const PRODUCT_IMAGE_REVISION = "20260926";

export function getProductImageUrl(imageUrl: string | null | undefined) {
  if (!imageUrl || !imageUrl.startsWith("/assets/products/")) {
    return imageUrl ?? null;
  }

  const url = new URL(imageUrl, "https://karimoff.site");
  url.searchParams.set("v", PRODUCT_IMAGE_REVISION);
  return `${url.pathname}${url.search}`;
}
