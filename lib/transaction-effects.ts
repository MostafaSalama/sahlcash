import type { TransactionDoc, TransactionType } from "@/types/firestore";
import type { RechargeSource } from "@/types/firestore";

export interface TransactionEffects {
  cashEffect: number;
  walletEffect: number;
  secondaryWalletEffect?: number;
}

/**
 * Ledger deltas for one transaction (fee is store profit; amounts follow helpers below).
 *
 * - cash_in: customer gives cash (amount + fee), merchant sends `amount` from wallet.
 * - cash_out: customer sends `amount + fee` to merchant wallet, merchant hands `amount` cash.
 * - bill_payment: same pattern as cash_in.
 * - transfer: `amount` moves from secondary wallet out to primary wallet in; `fee` collected in cash drawer.
 * - buy_cards: cash sale amount + fee, no wallet movement.
 */
export function computeTransactionEffects(
  type: TransactionType,
  amount: number,
  fee: number
): TransactionEffects {
  const a = Math.max(0, amount);
  const f = Math.max(0, fee);

  switch (type) {
    case "cash_in":
      return { cashEffect: a + f, walletEffect: -a };
    case "cash_out":
      return { cashEffect: -a, walletEffect: a + f };
    case "bill_payment":
      return { cashEffect: a + f, walletEffect: -a };
    case "transfer":
      return { cashEffect: f, walletEffect: a, secondaryWalletEffect: -a };
    case "buy_cards":
      return { cashEffect: a + f, walletEffect: 0 };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/** Apply recharge doc effects (wallet balance already separate from TransactionDoc). */
export function computeRechargeEffects(
  amount: number,
  source: RechargeSource
): { cashEffect: number; walletEffect: number } {
  const a = Math.max(0, amount);
  if (source === "cash") return { cashEffect: -a, walletEffect: a };
  return { cashEffect: 0, walletEffect: a };
}

/** Snapshot effects from a persisted transaction row. */
export function effectsFromTransaction(tx: TransactionDoc): {
  walletId: string;
  walletDelta: number;
  secondaryId?: string;
  secondaryDelta?: number;
  cashDelta: number;
} {
  return {
    walletId: tx.walletId,
    walletDelta: tx.walletEffect,
    secondaryId: tx.secondaryWalletId,
    secondaryDelta: tx.secondaryWalletEffect,
    cashDelta: tx.cashEffect,
  };
}
