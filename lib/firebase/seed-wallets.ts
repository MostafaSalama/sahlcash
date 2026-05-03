import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import type { WalletDoc } from "@/types/firestore";

const defaults: Omit<WalletDoc, "createdAt" | "updatedAt">[] = [
  {
    nameEn: "Cash",
    nameAr: "نقدي",
    type: "cash",
    defaultFeePercent: 0,
    defaultFeeFixed: 0,
    color: "#16a34a",
    icon: "banknote",
    isActive: true,
    sortOrder: 0,
  },
  {
    nameEn: "Vodafone Cash",
    nameAr: "فودافون كاش",
    type: "ewallet",
    defaultFeePercent: 0,
    defaultFeeFixed: 0,
    color: "#dc2626",
    icon: "wallet",
    isActive: true,
    sortOrder: 1,
    lowBalanceAlert: 500,
  },
  {
    nameEn: "InstaPay",
    nameAr: "انستاباي",
    type: "bank",
    defaultFeePercent: 0,
    defaultFeeFixed: 0,
    color: "#7c3aed",
    icon: "building-2",
    isActive: true,
    sortOrder: 2,
    lowBalanceAlert: 500,
  },
  {
    nameEn: "Fawry POS",
    nameAr: "فوري POS",
    type: "pos",
    defaultFeePercent: 1,
    defaultFeeFixed: 0,
    color: "#2563eb",
    icon: "credit-card",
    isActive: true,
    sortOrder: 3,
  },
  {
    nameEn: "Orange Cash",
    nameAr: "أورانج كاش",
    type: "ewallet",
    defaultFeePercent: 0,
    defaultFeeFixed: 0,
    color: "#ea580c",
    icon: "wallet",
    isActive: true,
    sortOrder: 4,
    lowBalanceAlert: 500,
  },
  {
    nameEn: "Etisalat Cash",
    nameAr: "اتصالات كاش",
    type: "ewallet",
    defaultFeePercent: 0,
    defaultFeeFixed: 0,
    color: "#0891b2",
    icon: "wallet",
    isActive: true,
    sortOrder: 5,
    lowBalanceAlert: 500,
  },
  {
    nameEn: "WE Pay",
    nameAr: "وي باي",
    type: "ewallet",
    defaultFeePercent: 0,
    defaultFeeFixed: 0,
    color: "#db2777",
    icon: "wallet",
    isActive: true,
    sortOrder: 6,
    lowBalanceAlert: 500,
  },
  {
    nameEn: "Bank transfer",
    nameAr: "تحويل بنكي",
    type: "bank",
    defaultFeePercent: 0,
    defaultFeeFixed: 0,
    color: "#64748b",
    icon: "landmark",
    isActive: true,
    sortOrder: 7,
    lowBalanceAlert: 500,
  },
];

export async function seedDefaultWallets(db: Firestore, storeId: string) {
  const batch = writeBatch(db);
  const walletsCol = collection(db, "stores", storeId, "wallets");
  for (const w of defaults) {
    const ref = doc(walletsCol);
    batch.set(ref, {
      ...w,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const balRef = doc(db, "stores", storeId, "walletBalances", ref.id);
    batch.set(balRef, {
      currentBalance: 0,
      lastUpdatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}
