import "server-only";

import { YooKassaError } from "./errors";

export type YooKassaConfiguration = {
  baseUrl: "https://api.yookassa.ru/v3";
  returnUrl: string;
  secretKey: string;
  shopId: string;
  webhookUrl: string;
};

function sameOriginUrl(value: string | undefined, origin: URL, pathname: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.origin !== origin.origin ||
      url.pathname !== pathname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function getYooKassaConfiguration(): YooKassaConfiguration | null {
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();
  const appOriginValue = process.env.APP_ORIGIN?.trim();
  if (!shopId || !secretKey || !appOriginValue) return null;

  let appOrigin: URL;
  try {
    appOrigin = new URL(appOriginValue);
  } catch {
    return null;
  }

  if (
    appOrigin.username ||
    appOrigin.password ||
    appOrigin.search ||
    appOrigin.hash ||
    (appOrigin.pathname !== "/" && appOrigin.pathname !== "") ||
    (appOrigin.protocol !== "https:" && process.env.NODE_ENV === "production")
  ) return null;
  const returnUrl = sameOriginUrl(
    process.env.YOOKASSA_RETURN_URL,
    appOrigin,
    "/checkout/payment/return"
  );
  const webhookUrl = sameOriginUrl(
    process.env.YOOKASSA_WEBHOOK_URL,
    appOrigin,
    "/api/webhooks/yookassa"
  );
  if (!returnUrl || !webhookUrl) return null;

  return {
    baseUrl: "https://api.yookassa.ru/v3",
    returnUrl,
    secretKey,
    shopId,
    webhookUrl
  };
}

export function requireYooKassaConfiguration() {
  const configuration = getYooKassaConfiguration();
  if (!configuration) {
    throw new YooKassaError({
      message: "YooKassa configuration is incomplete.",
      kind: "configuration",
      providerCode: "CONFIGURATION_INCOMPLETE"
    });
  }
  return configuration;
}

export function isYooKassaCheckoutEnabled() {
  return (
    process.env.PAYMENTS_ENABLED === "true" &&
    isYooKassaReconciliationEnabled()
  );
}

export function isYooKassaReconciliationEnabled() {
  return process.env.TEST_ORDER_MODE !== "true" && Boolean(getYooKassaConfiguration());
}
