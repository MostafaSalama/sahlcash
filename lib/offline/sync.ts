import type { Firestore } from "firebase/firestore";
import {
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";
import {
  commitShiftExpenseWithBalances,
  commitShiftTransaction,
  commitWalletRecharge,
  getBalanceDeltasFromPayload,
  stripBalanceMeta,
} from "@/lib/firebase/balance-batch";
import { offlineDb } from "./db";

function stripUndefined(obj: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export async function enqueuePendingWrite(
  entry: Omit<
    import("@/types/firestore").PendingWrite,
    "createdAt"
  > & { createdAt?: number }
) {
  if (!offlineDb) return;
  await offlineDb.pendingWrites.put({
    ...entry,
    createdAt: entry.createdAt ?? Date.now(),
  });
}

export async function flushPendingWrites(db: Firestore) {
  if (
    !offlineDb ||
    (typeof navigator !== "undefined" && !navigator.onLine)
  ) {
    return { flushed: 0 };
  }
  const all = await offlineDb.pendingWrites.toArray();
  let flushed = 0;
  for (const item of all) {
    try {
      const rawPayload = stripUndefined(
        item.payload as Record<string, unknown>
      );
      const deltas = getBalanceDeltasFromPayload(rawPayload);

      if (item.collection === "transactions") {
        if (!deltas) {
          console.error("Missing balance deltas for offline transaction", item.id);
          break;
        }
        await commitShiftTransaction(
          db,
          item.storeId,
          item.shiftId,
          rawPayload,
          deltas
        );
      } else if (item.collection === "expenses") {
        if (!deltas) {
          console.error("Missing balance deltas for offline expense", item.id);
          break;
        }
        await commitShiftExpenseWithBalances(
          db,
          item.storeId,
          item.shiftId,
          rawPayload,
          deltas
        );
      } else if (item.collection === "walletRecharges") {
        if (!deltas) {
          console.error("Missing balance deltas for offline recharge", item.id);
          break;
        }
        await commitWalletRecharge(db, item.storeId, rawPayload, deltas);
      } else {
        const base = collection(
          db,
          "stores",
          item.storeId,
          "shifts",
          item.shiftId,
          item.collection
        );
        await addDoc(base, {
          ...stripBalanceMeta(rawPayload),
          createdAt: serverTimestamp(),
        });
      }

      await offlineDb.pendingWrites.delete(item.id);
      flushed++;
    } catch (e) {
      console.error("Sync failed for pending write", item.id, e);
      break;
    }
  }
  return { flushed };
}

export async function countPendingWrites(): Promise<number> {
  if (!offlineDb) return 0;
  return offlineDb.pendingWrites.count();
}
