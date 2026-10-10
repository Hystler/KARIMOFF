import type { RepeatOrderIssue } from "./repeat-order";

const REPEAT_ORDER_NOTICE_KEY = "karimoff_repeat_order_notice_v1";

export function readRepeatOrderNotice(cartSnapshot: string): RepeatOrderIssue[] {
  try {
    const raw = window.sessionStorage.getItem(REPEAT_ORDER_NOTICE_KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw) as { cartSnapshot?: unknown; issues?: unknown };
    if (saved.cartSnapshot !== cartSnapshot || !Array.isArray(saved.issues)) return [];
    return saved.issues.filter((issue): issue is RepeatOrderIssue =>
      typeof issue?.itemId === "string" && typeof issue?.name === "string" && typeof issue?.reason === "string"
    );
  } catch {
    return [];
  }
}

export function saveRepeatOrderNotice(cartSnapshot: string, issues: RepeatOrderIssue[]) {
  try {
    if (issues.length) {
      window.sessionStorage.setItem(REPEAT_ORDER_NOTICE_KEY, JSON.stringify({ cartSnapshot, issues }));
    } else {
      window.sessionStorage.removeItem(REPEAT_ORDER_NOTICE_KEY);
    }
  } catch {
    // The live notice remains visible if storage is unavailable.
  }
}
