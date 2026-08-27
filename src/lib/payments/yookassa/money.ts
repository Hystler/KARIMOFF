import type { YooKassaAmount } from "./types";

const MONEY_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

export function moneyToMinorUnits(value: string): bigint {
  const normalized = value.trim();
  const match = MONEY_PATTERN.exec(normalized);
  if (!match) throw new Error("INVALID_MONEY_VALUE");

  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return whole * BigInt(100) + BigInt(fraction || "0");
}

export function minorUnitsToMoney(value: bigint): string {
  if (value < BigInt(0)) throw new Error("NEGATIVE_MONEY_VALUE");
  const whole = value / BigInt(100);
  const fraction = String(value % BigInt(100)).padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function normalizeMoney(value: string): string {
  return minorUnitsToMoney(moneyToMinorUnits(value));
}

export function rubles(value: string | bigint): YooKassaAmount {
  return {
    value: typeof value === "bigint" ? minorUnitsToMoney(value) : normalizeMoney(value),
    currency: "RUB"
  };
}

export function multiplyMoney(value: string, quantity: number): bigint {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("INVALID_QUANTITY");
  return moneyToMinorUnits(value) * BigInt(quantity);
}
