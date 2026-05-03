import Dexie, { type Table } from "dexie";
import type { PendingWrite } from "@/types/firestore";

export class SahlCashDexie extends Dexie {
  pendingWrites!: Table<PendingWrite, string>;

  constructor() {
    super("sahlCashDB");
    this.version(1).stores({
      pendingWrites: "id, storeId, shiftId, collection, createdAt",
    });
  }
}

export const offlineDb = typeof window !== "undefined" ? new SahlCashDexie() : null;
