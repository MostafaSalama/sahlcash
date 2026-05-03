import type { FeeType } from "@/types/firestore";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Fee earned from the customer (store profit).
 * - fixed: feeFixed (clamped)
 * - percent: amount * (feePercent / 100), capped at amount
 * - manual: manualFee ?? 0
 */
export function computeFee(
  amount: number,
  feeType: FeeType,
  feePercent: number,
  feeFixed: number,
  manualFee?: number
): number {
  const amt = Math.max(0, amount);
  const pct = Math.max(0, feePercent || 0);
  const fixed = Math.max(0, feeFixed || 0);

  if (feeType === "manual") {
    return roundMoney(Math.max(0, manualFee ?? 0));
  }
  if (feeType === "fixed") {
    return roundMoney(fixed);
  }
  return roundMoney(Math.min(amt, (amt * pct) / 100 + fixed));
}
