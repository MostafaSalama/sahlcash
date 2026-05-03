import type { ExpenseDoc } from "@/types/firestore";
import type { TransactionDoc } from "@/types/firestore";
import type { WalletRechargeDoc } from "@/types/firestore";
import { computeRechargeEffects } from "@/lib/transaction-effects";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Union all wallet ids we need keys for. */
function collectWalletIds(
  opening: Record<string, number>,
  transactions: TransactionDoc[],
  recharges: Pick<WalletRechargeDoc, "walletId">[],
  declared?: Record<string, number>
): Set<string> {
  const ids = new Set<string>(Object.keys(opening));
  for (const tx of transactions) {
    ids.add(tx.walletId);
    if (tx.secondaryWalletId) ids.add(tx.secondaryWalletId);
  }
  for (const r of recharges) ids.add(r.walletId);
  if (declared) for (const k of Object.keys(declared)) ids.add(k);
  return ids;
}

/**
 * Expected closing balance per wallet after applying shift transactions,
 * recharges (during shift), and cash expenses on the cash wallet.
 */
export function computeExpectedBalances(
  openingBalances: Record<string, number>,
  transactions: TransactionDoc[],
  recharges: WalletRechargeDoc[],
  expenses: Pick<ExpenseDoc, "amount">[],
  cashWalletId: string | null,
  totalExpenseCashImpact: number
): Record<string, number> {
  const ids = collectWalletIds(openingBalances, transactions, recharges);
  const expected: Record<string, number> = {};
  for (const id of ids) {
    expected[id] = openingBalances[id] ?? 0;
  }

  for (const tx of transactions) {
    expected[tx.walletId] = roundMoney(
      (expected[tx.walletId] ?? 0) + tx.walletEffect
    );
    if (tx.secondaryWalletId) {
      expected[tx.secondaryWalletId] = roundMoney(
        (expected[tx.secondaryWalletId] ?? 0) +
          (tx.secondaryWalletEffect ?? 0)
      );
    }
    if (cashWalletId) {
      expected[cashWalletId] = roundMoney(
        (expected[cashWalletId] ?? 0) + tx.cashEffect
      );
    }
  }

  for (const r of recharges) {
    const { cashEffect, walletEffect } = computeRechargeEffects(
      r.amount,
      r.source
    );
    expected[r.walletId] = roundMoney(
      (expected[r.walletId] ?? 0) + walletEffect
    );
    if (cashWalletId && cashEffect !== 0) {
      expected[cashWalletId] = roundMoney(
        (expected[cashWalletId] ?? 0) + cashEffect
      );
    }
  }

  if (cashWalletId) {
    expected[cashWalletId] = roundMoney(
      (expected[cashWalletId] ?? 0) - totalExpenseCashImpact
    );
  }

  return expected;
}

/** Legacy: treats missing declared keys as 0 (avoid for shift close). */
export function computeDiscrepancies(
  expected: Record<string, number>,
  declared: Record<string, number>
): Record<string, number> {
  const keys = collectWalletIds(expected, [], [], declared);
  const out: Record<string, number> = {};
  for (const id of keys) {
    const exp = expected[id] ?? 0;
    const dec = declared[id] ?? 0;
    out[id] = roundMoney(dec - exp);
  }
  return out;
}

/** Shift close: every wallet must have an explicit declared balance (no silent zero). */
export function computeDiscrepanciesForClose(
  expected: Record<string, number>,
  declared: Record<string, number>,
  walletIds: string[]
): {
  ok: boolean;
  discrepancies: Record<string, number>;
  missingWalletIds: string[];
} {
  const missingWalletIds = walletIds.filter((id) => !(id in declared));
  if (missingWalletIds.length > 0) {
    return { ok: false, discrepancies: {}, missingWalletIds };
  }
  const discrepancies: Record<string, number> = {};
  for (const id of walletIds) {
    const exp = expected[id] ?? 0;
    const dec = declared[id] ?? 0;
    discrepancies[id] = roundMoney(dec - exp);
  }
  return { ok: true, discrepancies, missingWalletIds: [] };
}
