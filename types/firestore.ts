import type { Timestamp } from "firebase/firestore";

export type UserRole = "admin" | "cashier";

/** Wallet channel kind (was PaymentMethodType) */
export type WalletType = "cash" | "pos" | "ewallet" | "bank" | "other";

export type ShiftStatus = "open" | "closed";

export type ExpenseCategory = "supplier" | "supplies" | "other";

export type TransactionType =
  | "cash_in"
  | "cash_out"
  | "bill_payment"
  | "transfer"
  | "buy_cards";

export type FeeType = "fixed" | "percent" | "manual";

export type RechargeSource =
  | "cash"
  | "bank_transfer"
  | "distributor"
  | "other";

export interface StoreDoc {
  name: string;
  currency: string;
  timezone: string;
  ownerId: string;
  inviteCode: string;
  logoUrl?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface StoreUserDoc {
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  /** Set once when cashier joins via invite */
  inviteCodeUsed?: string;
  createdAt: Timestamp;
}

export interface WalletDoc {
  nameEn: string;
  nameAr: string;
  type: WalletType;
  /** Default % fee for customer-facing transactions */
  defaultFeePercent: number;
  /** Default fixed fee (same currency as store) */
  defaultFeeFixed: number;
  color: string;
  icon: string;
  isActive: boolean;
  sortOrder: number;
  /** Alert when balance at or below this (optional; non-cash wallets) */
  lowBalanceAlert?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface WalletBalanceDoc {
  currentBalance: number;
  lastUpdatedAt: Timestamp;
}

export interface WalletRechargeDoc {
  walletId: string;
  shiftId?: string;
  amount: number;
  source: RechargeSource;
  /** Cash impact when source is cash (drawer decreases) */
  cashWalletId?: string;
  note?: string;
  createdAt: Timestamp;
  clientId?: string;
}

export interface ShiftDoc {
  cashierId: string;
  cashierEmail?: string;
  status: ShiftStatus;
  /** Snapshot of each wallet balance at shift open (includes cash wallet id) */
  openingBalances: Record<string, number>;
  /** Declared balance per wallet at close (physical count / app balance) */
  declaredBalances?: Record<string, number>;
  /** Expected balance per wallet after applying txs + recharges + expenses */
  expectedBalances?: Record<string, number>;
  discrepancies?: Record<string, number>;
  summary?: ShiftSummary;
  startedAt: Timestamp;
  closedAt?: Timestamp;
}

export interface ShiftSummary {
  /** Total fees earned (store profit) */
  totalFees: number;
  /** Sum of transaction principal amounts (absolute) */
  totalVolume: number;
  totalExpenses: number;
  transactionCount: number;
  rechargeCount?: number;
  /** Optional breakdown */
  countsByType?: Partial<Record<TransactionType, number>>;
}

export interface TransactionDoc {
  type: TransactionType;
  /** Primary wallet (destination for inflows on that wallet, etc. — see computeTransactionEffects) */
  walletId: string;
  /** For transfers: the sending wallet (money leaves this balance) */
  secondaryWalletId?: string;
  /** Principal transaction amount (before fee, consistent with business logic helpers) */
  amount: number;
  /** Fee charged to customer (store profit); 0 for wallet_recharge */
  fee: number;
  feeType: FeeType;
  /** Change to cash drawer for this store's cash wallet */
  cashEffect: number;
  /** Effect on primary wallet balance */
  walletEffect: number;
  /** Effect on secondary wallet (transfer out leg) */
  secondaryWalletEffect?: number;
  customerName?: string;
  customerPhone?: string;
  note?: string;
  createdAt: Timestamp;
  clientId?: string;
}

export interface ExpenseDoc {
  amount: number;
  category: ExpenseCategory;
  note?: string;
  receiptUrl?: string;
  createdAt: Timestamp;
  clientId?: string;
}

export interface CorrectionDoc {
  shiftId: string;
  adminId: string;
  walletId?: string;
  amount: number;
  reason: string;
  createdAt: Timestamp;
}

export interface PendingWrite {
  id: string;
  storeId: string;
  shiftId: string;
  collection: "transactions" | "expenses" | "walletRecharges";
  payload: Record<string, unknown>;
  createdAt: number;
}
