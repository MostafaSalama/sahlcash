import Dexie, { type Table } from "dexie";
import type { PendingAttachment, PendingWrite } from "@/types/firestore";

export class SahlCashDexie extends Dexie {
  pendingWrites!: Table<PendingWrite, string>;
  pendingAttachments!: Table<PendingAttachment, string>;

  constructor() {
    super("sahlCashDB");
    this.version(1).stores({
      pendingWrites: "id, storeId, shiftId, collection, createdAt",
    });
    this.version(2).stores({
      pendingWrites: "id, storeId, shiftId, collection, createdAt",
      pendingReceipts: "expenseDocId, storeId, shiftId",
    });
    this.version(3)
      .stores({
        pendingWrites: "id, storeId, shiftId, collection, createdAt",
        pendingAttachments: "targetDocId, storeId, shiftId, kind",
      })
      .upgrade(async (tx) => {
        const legacy = tx.table("pendingReceipts");
        const rows = await legacy.toArray();
        const attachments = tx.table("pendingAttachments");
        for (const r of rows as Array<{
          expenseDocId: string;
          storeId: string;
          shiftId: string;
          fileName: string;
          blob: Blob;
        }>) {
          await attachments.add({
            kind: "expenseReceipt",
            targetDocId: r.expenseDocId,
            storeId: r.storeId,
            shiftId: r.shiftId,
            fileName: r.fileName,
            blob: r.blob,
          });
        }
      });
  }
}

export const offlineDb =
  typeof window !== "undefined" ? new SahlCashDexie() : null;
