import "server-only";

import { createSign } from "node:crypto";
import type { LoyaltyCard } from "@/lib/loyalty-card";
import { createLoyaltyCardToken } from "@/lib/loyalty-card";
import { decodeBase64Secret, getWalletConfiguration } from "./config";

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createGoogleWalletSaveUrl(params: {
  card: LoyaltyCard;
  customerName: string;
  pointsBalance: number;
}) {
  if (!getWalletConfiguration().google) throw new Error("Google Wallet is not configured.");
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID!.trim();
  const classId = process.env.GOOGLE_WALLET_CLASS_ID!.trim();
  const serviceEmail = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL!.trim();
  const origin = new URL(process.env.APP_ORIGIN!).host;
  if (!/^\d+$/.test(issuerId) || !classId.startsWith(`${issuerId}.`)) {
    throw new Error("Google Wallet issuer configuration is invalid.");
  }

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceEmail,
    aud: "google",
    origins: [origin],
    typ: "savetowallet",
    iat: now,
    exp: now + 10 * 60,
    payload: {
      loyaltyObjects: [{
        id: `${issuerId}.${params.card.id.replaceAll("-", "")}`,
        classId,
        state: "ACTIVE",
        accountName: params.customerName.slice(0, 20),
        accountId: params.card.publicCode,
        loyaltyPoints: {
          label: "Баллы",
          balance: { string: String(Math.max(0, params.pointsBalance)) }
        },
        barcode: {
          type: "QR_CODE",
          value: createLoyaltyCardToken(params.card),
          alternateText: params.card.publicCode
        }
      }]
    }
  };
  const header = { alg: "RS256", typ: "JWT" };
  const unsigned = `${encode(header)}.${encode(claims)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(decodeBase64Secret("GOOGLE_WALLET_PRIVATE_KEY_BASE64")).toString("base64url");
  return `https://pay.google.com/gp/v/save/${unsigned}.${signature}`;
}
