import "server-only";

import { PKPass } from "passkit-generator";
import sharp from "sharp";
import type { LoyaltyCard } from "@/lib/loyalty-card";
import { createLoyaltyCardToken } from "@/lib/loyalty-card";
import { decodeBase64Secret, getWalletConfiguration } from "./config";

function brandMarkSvg() {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
      <rect width="180" height="180" rx="30" fill="#111114"/>
      <circle cx="90" cy="90" r="61" fill="#fb670a"/>
      <text x="90" y="111" text-anchor="middle" font-family="Arial, sans-serif" font-size="72" font-weight="900" fill="#ffffff">K</text>
    </svg>
  `);
}

async function icon(size: number) {
  return sharp(brandMarkSvg()).resize(size, size).png().toBuffer();
}

export async function createAppleWalletPass(params: {
  card: LoyaltyCard;
  customerName: string;
  pointsBalance: number;
}) {
  if (!getWalletConfiguration().apple) throw new Error("Apple Wallet is not configured.");
  const [icon1x, icon2x, logo1x, logo2x] = await Promise.all([
    icon(29), icon(58), icon(80), icon(160)
  ]);
  const pass = new PKPass(
    {
      "icon.png": icon1x,
      "icon@2x.png": icon2x,
      "logo.png": logo1x,
      "logo@2x.png": logo2x
    },
    {
      wwdr: decodeBase64Secret("APPLE_WALLET_WWDR_CERT_BASE64"),
      signerCert: decodeBase64Secret("APPLE_WALLET_SIGNER_CERT_BASE64"),
      signerKey: decodeBase64Secret("APPLE_WALLET_SIGNER_KEY_BASE64"),
      signerKeyPassphrase: process.env.APPLE_WALLET_SIGNER_KEY_PASSPHRASE?.trim()
    },
    {
      formatVersion: 1,
      serialNumber: params.card.id,
      passTypeIdentifier: process.env.APPLE_WALLET_PASS_TYPE_ID!.trim(),
      teamIdentifier: process.env.APPLE_WALLET_TEAM_ID!.trim(),
      organizationName: "KARIMOFF",
      description: "Карта гостя KARIMOFF",
      logoText: "KARIMOFF",
      backgroundColor: "rgb(17, 17, 20)",
      foregroundColor: "rgb(255, 255, 255)",
      labelColor: "rgb(251, 103, 10)",
      sharingProhibited: true
    }
  );
  pass.type = "storeCard";
  pass.primaryFields.push({ key: "balance", label: "БАЛЛЫ", value: Math.max(0, params.pointsBalance), numberStyle: "PKNumberStyleDecimal" });
  pass.secondaryFields.push({ key: "holder", label: "ГОСТЬ", value: params.customerName.slice(0, 40) });
  pass.auxiliaryFields.push({ key: "card", label: "КАРТА", value: params.card.publicCode });
  pass.backFields.push(
    { key: "about", label: "Карта гостя", value: "Покажите QR-код кассиру перед оплатой, чтобы заказ попал в ваш профиль KARIMOFF." },
    { key: "security", label: "Безопасность", value: "QR идентифицирует карту, но не разрешает списание баллов и не открывает персональные данные." }
  );
  pass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: createLoyaltyCardToken(params.card),
    messageEncoding: "iso-8859-1",
    altText: params.card.publicCode
  });
  return pass.getAsBuffer();
}
