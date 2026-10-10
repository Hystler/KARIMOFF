import "server-only";

export type StagingDemoCustomer = {
  id: "staging-demo-customer";
  name: string;
  phone: string;
  birthday: null;
};

export function isStagingUiMode() {
  return process.env.STAGING_UI_MODE === "true";
}

export function isStagingFixtureMode() {
  return isStagingUiMode() && process.env.STAGING_DATA_MODE === "fixture";
}

export function isStagingDeliveryUiEnabled() {
  return isStagingUiMode() && process.env.DELIVERY_ENABLED === "true";
}

export function getStagingDemoCustomer(): StagingDemoCustomer {
  return {
    id: "staging-demo-customer",
    name: "Демо-покупатель",
    phone: "Не сохраняется",
    birthday: null
  };
}
