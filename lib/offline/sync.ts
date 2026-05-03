import type { Firestore } from "firebase/firestore";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import {
  commitShiftExpenseWithBalances,
  commitShiftTransaction,
  commitWalletRecharge,
  getBalanceDeltasFromPayload,
  stripBalanceMeta,
} from "@/lib/firebase/balance-batch";
import { getFirebaseStorage } from "@/lib/firebase/client";
import type {
  PendingAttachment,
  PendingReceipt,
  PendingWrite,
} from "@/types/firestore";
import { offlineDb } from "./db";

const MAX_FLUSH_ATTEMPTS = 8;

function stripUndefined(obj: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export async function enqueuePendingWrite(
  entry: Omit<PendingWrite, "createdAt"> & { createdAt?: number }
) {
  if (!offlineDb) return;
  await offlineDb.pendingWrites.put({
    ...entry,
    createdAt: entry.createdAt ?? Date.now(),
    attempts: entry.attempts ?? 0,
  });
}

export async function enqueuePendingAttachment(entry: PendingAttachment) {
  if (!offlineDb) return;
  await offlineDb.pendingAttachments.put(entry);
}

/** @deprecated Use enqueuePendingAttachment with kind expenseReceipt */
export async function enqueuePendingReceipt(entry: PendingReceipt) {
  await enqueuePendingAttachment({
    kind: "expenseReceipt",
    targetDocId: entry.expenseDocId,
    storeId: entry.storeId,
    shiftId: entry.shiftId,
    fileName: entry.fileName,
    blob: entry.blob,
  });
}

async function flushQueuedAttachment(
  db: Firestore,
  storeId: string,
  shiftId: string,
  targetDocId: string
) {
  if (!offlineDb) return;
  const pending = await offlineDb.pendingAttachments.get(targetDocId);
  if (!pending) return;
  const storage = getFirebaseStorage();
  const safeName = pending.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageSegment =
    pending.kind === "expenseReceipt"
      ? `expenses/${targetDocId}_${safeName}`
      : `transactions/${targetDocId}_${safeName}`;
  const path = `stores/${storeId}/shifts/${shiftId}/${storageSegment}`;
  const r = ref(storage, path);
  await uploadBytes(r, pending.blob, {
    contentType: pending.blob.type || "image/jpeg",
  });
  const url = await getDownloadURL(r);
  if (pending.kind === "expenseReceipt") {
    await updateDoc(
      doc(
        db,
        "stores",
        storeId,
        "shifts",
        shiftId,
        "expenses",
        targetDocId
      ),
      { receiptUrl: url }
    );
  } else {
    await updateDoc(
      doc(
        db,
        "stores",
        storeId,
        "shifts",
        shiftId,
        "transactions",
        targetDocId
      ),
      { photoUrl: url }
    );
  }
  await offlineDb.pendingAttachments.delete(targetDocId);
}

export async function flushPendingWrites(db: Firestore) {
  if (
    !offlineDb ||
    (typeof navigator !== "undefined" && !navigator.onLine)
  ) {
    return { flushed: 0 };
  }
  const all = await offlineDb.pendingWrites.toArray();
  all.sort((a, b) => a.createdAt - b.createdAt);
  let flushed = 0;

  for (const item of all) {
    const tries = item.attempts ?? 0;
    if (tries >= MAX_FLUSH_ATTEMPTS) {
      console.error("Pending write exceeded retries, skipping", item.id);
      continue;
    }

    try {
      const rawPayload = stripUndefined(
        item.payload as Record<string, unknown>
      );
      const deltas = getBalanceDeltasFromPayload(rawPayload);

      if (item.collection === "transactions") {
        if (!deltas) {
          console.error("Missing balance deltas for offline transaction", item.id);
          await offlineDb.pendingWrites.update(item.id, {
            attempts: tries + 1,
          });
          continue;
        }
        await commitShiftTransaction(
          db,
          item.storeId,
          item.shiftId,
          rawPayload,
          deltas,
          item.transactionDocId
        );
        if (item.transactionDocId) {
          await flushQueuedAttachment(
            db,
            item.storeId,
            item.shiftId,
            item.transactionDocId
          );
        }
      } else if (item.collection === "expenses") {
        if (!deltas) {
          console.error("Missing balance deltas for offline expense", item.id);
          await offlineDb.pendingWrites.update(item.id, {
            attempts: tries + 1,
          });
          continue;
        }
        await commitShiftExpenseWithBalances(
          db,
          item.storeId,
          item.shiftId,
          rawPayload,
          deltas,
          item.expenseDocId
        );
        if (item.expenseDocId) {
          await flushQueuedAttachment(
            db,
            item.storeId,
            item.shiftId,
            item.expenseDocId
          );
        }
      } else if (item.collection === "walletRecharges") {
        if (!deltas) {
          console.error("Missing balance deltas for offline recharge", item.id);
          await offlineDb.pendingWrites.update(item.id, {
            attempts: tries + 1,
          });
          continue;
        }
        await commitWalletRecharge(db, item.storeId, rawPayload, deltas);
      } else if (item.collection === "shiftClose") {
        const patch = stripUndefined(
          (rawPayload.shiftClosePatch as Record<string, unknown>) ?? {}
        );
        await updateDoc(
          doc(db, "stores", item.storeId, "shifts", item.shiftId),
          {
            ...patch,
            closedAt: serverTimestamp(),
          }
        );
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
      await offlineDb.pendingWrites.update(item.id, {
        attempts: tries + 1,
      });
    }
  }
  return { flushed };
}

export async function countPendingWrites(): Promise<number> {
  if (!offlineDb) return 0;
  return offlineDb.pendingWrites.count();
}
