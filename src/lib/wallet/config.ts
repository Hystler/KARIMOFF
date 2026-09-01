import "server-only";

function present(name: string) {
  return Boolean(process.env[name]?.trim());
}

export function getWalletConfiguration() {
  const apple = [
    "APPLE_WALLET_PASS_TYPE_ID",
    "APPLE_WALLET_TEAM_ID",
    "APPLE_WALLET_WWDR_CERT_BASE64",
    "APPLE_WALLET_SIGNER_CERT_BASE64",
    "APPLE_WALLET_SIGNER_KEY_BASE64"
  ].every(present);
  const google = [
    "GOOGLE_WALLET_ISSUER_ID",
    "GOOGLE_WALLET_CLASS_ID",
    "GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_WALLET_PRIVATE_KEY_BASE64",
    "APP_ORIGIN"
  ].every(present);
  return { apple, google };
}

export function decodeBase64Secret(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return Buffer.from(value, "base64");
}
