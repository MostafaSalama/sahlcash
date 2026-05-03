import {
  collection,
  doc,
  increment,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";

const BALANCE_DELTA_KEY = "_balanceDeltas";

/** Strip internal offline-only keys before writing to Firestore. */
export function stripBalanceMeta(payload: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit delta meta key
  const { [BALANCE_DELTA_KEY]: _omit, ...rest } = payload;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function getBalanceDeltasFromPayload(
  payload: Record<string, unknown>
): Record<string, number> | null {
  const raw = payload[BALANCE_DELTA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number") out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export function attachBalanceDeltas(
  payload: Record<string, unknown>,
  deltas: Record<string, number>
) {
  return { ...payload, [BALANCE_DELTA_KEY]: deltas };
}

export function aggregateTransactionBalanceDeltas(
  tx: {
    walletId: string;
    walletEffect: number;
    secondaryWalletId?: string;
    secondaryWalletEffect?: number;
    cashEffect: number;
  },
  cashWalletId: string | null
): Record<string, number> {
  const d: Record<string, number> = {};
  const add = (id: string, v: number) => {
    if (!v) return;
    d[id] = (d[id] ?? 0) + v;
  };
  add(tx.walletId, tx.walletEffect);
  if (tx.secondaryWalletId) {
    add(tx.secondaryWalletId, tx.secondaryWalletEffect ?? 0);
  }
  if (cashWalletId) add(cashWalletId, tx.cashEffect);
  return d;
}

export async function commitShiftTransaction(
  db: Firestore,
  storeId: string,
  shiftId: string,
  txPayload: Record<string, unknown>,
  balanceDeltas: Record<string, number>
) {
  const batch = writeBatch(db);
  const txRef = doc(
    collection(db, "stores", storeId, "shifts", shiftId, "transactions")
  );
  batch.set(txRef, {
    ...stripBalanceMeta(txPayload),
    createdAt: serverTimestamp(),
  });
  for (const [walletId, delta] of Object.entries(balanceDeltas)) {
    if (!delta) continue;
    const bRef = doc(db, "stores", storeId, "walletBalances", walletId);
    batch.update(bRef, {
      currentBalance: increment(delta),
      lastUpdatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function commitShiftExpenseWithBalances(
  db: Firestore,
  storeId: string,
  shiftId: string,
  expensePayload: Record<string, unknown>,
  balanceDeltas: Record<string, number>
) {
  const batch = writeBatch(db);
  const exRef = doc(
    collection(db, "stores", storeId, "shifts", shiftId, "expenses")
  );
  batch.set(exRef, {
    ...stripBalanceMeta(expensePayload),
    createdAt: serverTimestamp(),
  });
  for (const [walletId, delta] of Object.entries(balanceDeltas)) {
    if (!delta) continue;
    const bRef = doc(db, "stores", storeId, "walletBalances", walletId);
    batch.update(bRef, {
      currentBalance: increment(delta),
      lastUpdatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function commitShiftExpense(
  db: Firestore,
  storeId: string,
  shiftId: string,
  expensePayload: Record<string, unknown>,
  cashWalletId: string | null,
  expenseAmount: number
) {
  const deltas: Record<string, number> = {};
  if (cashWalletId && expenseAmount > 0) deltas[cashWalletId] = -expenseAmount;
  await commitShiftExpenseWithBalances(
    db,
    storeId,
    shiftId,
    expensePayload,
    deltas
  );
}

export async function commitWalletRecharge(
  db: Firestore,
  storeId: string,
  payload: Record<string, unknown>,
  balanceDeltas: Record<string, number>
) {
  const batch = writeBatch(db);
  const rRef = doc(collection(db, "stores", storeId, "walletRecharges"));
  batch.set(rRef, {
    ...stripBalanceMeta(payload),
    createdAt: serverTimestamp(),
  });
  for (const [walletId, delta] of Object.entries(balanceDeltas)) {
    if (!delta) continue;
    const bRef = doc(db, "stores", storeId, "walletBalances", walletId);
    batch.update(bRef, {
      currentBalance: increment(delta),
      lastUpdatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}
