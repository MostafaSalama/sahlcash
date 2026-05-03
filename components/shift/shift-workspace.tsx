"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";
import { useConnectivity } from "@/contexts/connectivity-context";
import {
  getDb,
  getFirebaseAuth,
  getFirebaseStorage,
} from "@/lib/firebase/client";
import { computeFee } from "@/lib/commission";
import {
  attachBalanceDeltas,
  aggregateTransactionBalanceDeltas,
  commitShiftExpense,
  commitShiftTransaction,
  commitWalletRecharge,
} from "@/lib/firebase/balance-batch";
import {
  computeExpectedBalances,
  computeDiscrepanciesForClose,
} from "@/lib/shift-math";
import {
  computeRechargeEffects,
  computeTransactionEffects,
} from "@/lib/transaction-effects";
import { formatMoney } from "@/lib/utils";
import {
  enqueuePendingAttachment,
  enqueuePendingReceipt,
  enqueuePendingWrite,
} from "@/lib/offline/sync";
import { AttachmentField } from "@/components/shift/attachment-field";
import { AttachmentThumbnail } from "@/components/shift/attachment-thumbnail";
import type {
  ExpenseDoc,
  FeeType,
  RechargeSource,
  ShiftDoc,
  TransactionDoc,
  TransactionType,
  WalletDoc,
  WalletRechargeDoc,
} from "@/types/firestore";

const QUICK_AMOUNTS = [50, 100, 200, 500, 1000];

type ShiftQueuedRow =
  | {
      clientId: string;
      kind: "tx";
      createdAt: number;
      type: TransactionType;
      walletId: string;
      secondaryWalletId?: string;
      amount: number;
      fee: number;
      hasPhotoQueued?: boolean;
    }
  | {
      clientId: string;
      kind: "expense";
      createdAt: number;
      category: string;
      amount: number;
      hasReceiptQueued?: boolean;
    }
  | {
      clientId: string;
      kind: "recharge";
      createdAt: number;
      walletId: string;
      amount: number;
      source: RechargeSource;
    };

const TX_TYPES: TransactionType[] = [
  "cash_in",
  "cash_out",
  "bill_payment",
  "transfer",
  "buy_cards",
];

export function ShiftWorkspace() {
  const t = useTranslations("shift");
  const tw = useTranslations("wallets");
  const tc = useTranslations("common");
  const locale = useLocale();
  const moneyLocale = locale === "ar" ? "ar-EG" : "en-US";
  const { storeId, store, profile, user } = useAuth();
  const { online, refreshPending } = useConnectivity();

  const [wallets, setWallets] = useState<(WalletDoc & { id: string })[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [activeShift, setActiveShift] = useState<
    (ShiftDoc & { id: string }) | null
  >(null);
  const [transactions, setTransactions] = useState<
    (TransactionDoc & { id: string })[]
  >([]);
  const [expenses, setExpenses] = useState<(ExpenseDoc & { id: string })[]>([]);
  const [recharges, setRecharges] = useState<
    (WalletRechargeDoc & { id: string })[]
  >([]);

  const [txType, setTxType] = useState<TransactionType>("cash_in");
  const [walletId, setWalletId] = useState("");
  const [secondaryWalletId, setSecondaryWalletId] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [feeType, setFeeType] = useState<FeeType>("percent");
  const [manualFeeStr, setManualFeeStr] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [txNote, setTxNote] = useState("");
  const [txPhotoFile, setTxPhotoFile] = useState<File | null>(null);
  const [showCustomerDetails, setShowCustomerDetails] = useState(false);

  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<string>("supplier");
  const [expenseNote, setExpenseNote] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const [initialCashFloatStr, setInitialCashFloatStr] = useState("");
  const [pendingQueuedRows, setPendingQueuedRows] = useState<ShiftQueuedRow[]>(
    []
  );
  const [handoverNoteClose, setHandoverNoteClose] = useState("");
  const [lastClosedShift, setLastClosedShift] = useState<
    (ShiftDoc & { id: string }) | null
  >(null);

  const [closeOpen, setCloseOpen] = useState(false);
  const [declaredMap, setDeclaredMap] = useState<Record<string, string>>({});

  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [rechargeWalletId, setRechargeWalletId] = useState("");
  const [rechargeAmountStr, setRechargeAmountStr] = useState("");
  const [rechargeSource, setRechargeSource] =
    useState<RechargeSource>("cash");

  const cashWalletId = useMemo(
    () => wallets.find((w) => w.type === "cash")?.id ?? null,
    [wallets]
  );

  const digitalWallets = useMemo(
    () => wallets.filter((w) => w.type !== "cash"),
    [wallets]
  );

  const currency = store?.currency ?? "EGP";

  useEffect(() => {
    if (!storeId) return;
    const db = getDb();
    const q = query(
      collection(db, "stores", storeId, "wallets"),
      where("isActive", "==", true)
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as WalletDoc),
      }));
      rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      setWallets(rows);
      setWalletId((prev) => prev || rows.find((w) => w.type !== "cash")?.id || "");
      setSecondaryWalletId((prev) =>
        prev || rows.filter((w) => w.type !== "cash")[1]?.id || ""
      );
      setRechargeWalletId((prev) => prev || rows.find((w) => w.type !== "cash")?.id || "");
    });
    return () => unsub();
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    const db = getDb();
    const unsub = onSnapshot(
      collection(db, "stores", storeId, "walletBalances"),
      (snap) => {
        const m: Record<string, number> = {};
        snap.docs.forEach((d) => {
          m[d.id] = (d.data().currentBalance as number) ?? 0;
        });
        setBalances(m);
      }
    );
    return () => unsub();
  }, [storeId]);

  useEffect(() => {
    if (!storeId || !user) return;
    const db = getDb();
    const q = query(
      collection(db, "stores", storeId, "shifts"),
      where("cashierId", "==", user.uid),
      where("status", "==", "open"),
      limit(1)
    );
    const unsub = onSnapshot(q, (snap) => {
      const doc0 = snap.docs[0];
      setActiveShift(
        doc0 ? { id: doc0.id, ...(doc0.data() as ShiftDoc) } : null
      );
    });
    return () => unsub();
  }, [storeId, user]);

  useEffect(() => {
    if (!storeId) {
      setLastClosedShift(null);
      return;
    }
    if (activeShift) {
      setLastClosedShift(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const db = getDb();
        const q = query(
          collection(db, "stores", storeId, "shifts"),
          orderBy("startedAt", "desc"),
          limit(40)
        );
        const snap = await getDocs(q);
        const closed = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as ShiftDoc) }))
          .find((s) => s.status === "closed");
        if (!cancelled) setLastClosedShift(closed ?? null);
      } catch {
        if (!cancelled) setLastClosedShift(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, activeShift]);

  useEffect(() => {
    if (!storeId || !activeShift) {
      setTransactions([]);
      setExpenses([]);
      setRecharges([]);
      return;
    }
    const db = getDb();
    const base = collection(
      db,
      "stores",
      storeId,
      "shifts",
      activeShift.id,
      "transactions"
    );
    const unsubTx = onSnapshot(
      query(base, orderBy("createdAt", "desc")),
      (snap) => {
        setTransactions(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as TransactionDoc),
          }))
        );
      }
    );
    const expCol = collection(
      db,
      "stores",
      storeId,
      "shifts",
      activeShift.id,
      "expenses"
    );
    const unsubEx = onSnapshot(
      query(expCol, orderBy("createdAt", "desc")),
      (snap) => {
        setExpenses(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as ExpenseDoc),
          }))
        );
      }
    );
    const rechQ = query(
      collection(db, "stores", storeId, "walletRecharges"),
      where("shiftId", "==", activeShift.id)
    );
    const unsubR = onSnapshot(rechQ, (snap) => {
      setRecharges(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as WalletRechargeDoc),
        }))
      );
    });
    return () => {
      unsubTx();
      unsubEx();
      unsubR();
    };
  }, [storeId, activeShift]);

  useEffect(() => {
    setPendingQueuedRows((rows) =>
      rows.filter((row) => {
        if (row.kind === "tx") {
          return !transactions.some((t) => t.clientId === row.clientId);
        }
        if (row.kind === "expense") {
          return !expenses.some((e) => e.clientId === row.clientId);
        }
        return !recharges.some((r) => r.clientId === row.clientId);
      })
    );
  }, [transactions, expenses, recharges]);

  const lowBalanceWarnings = useMemo(() => {
    return wallets.filter((w) => {
      if (w.type === "cash") return false;
      const low = w.lowBalanceAlert;
      if (low == null) return false;
      const b = balances[w.id] ?? 0;
      return b <= low;
    });
  }, [wallets, balances]);

  const expenseTotal = useMemo(
    () => expenses.reduce((s, e) => s + e.amount, 0),
    [expenses]
  );

  const feesThisShift = useMemo(
    () => transactions.reduce((s, x) => s + x.fee, 0),
    [transactions]
  );

  const volumeThisShift = useMemo(
    () => transactions.reduce((s, x) => s + x.amount, 0),
    [transactions]
  );

  const netChangeByWallet = useMemo(() => {
    if (!activeShift || !cashWalletId) return null;
    const expected = computeExpectedBalances(
      activeShift.openingBalances ?? {},
      transactions,
      recharges,
      expenses,
      cashWalletId,
      expenseTotal
    );
    const opening = activeShift.openingBalances ?? {};
    const out: Record<string, number> = {};
    for (const id of Object.keys(expected)) {
      out[id] =
        Math.round(((expected[id] ?? 0) - (opening[id] ?? 0)) * 100) / 100;
    }
    return out;
  }, [
    activeShift,
    cashWalletId,
    transactions,
    recharges,
    expenses,
    expenseTotal,
  ]);

  function walletLabel(m: WalletDoc & { id: string }) {
    return locale === "ar" ? m.nameAr || m.nameEn : m.nameEn || m.nameAr;
  }

  function balanceTone(w: WalletDoc & { id: string }): "success" | "warning" | "destructive" | "secondary" {
    if (w.type === "cash") return "secondary";
    const b = balances[w.id] ?? 0;
    const low = w.lowBalanceAlert;
    if (low != null && b <= 0) return "destructive";
    if (low != null && b <= low) return "warning";
    return "success";
  }

  async function startShift() {
    if (!storeId || !user) return;
    try {
      const db = getDb();
      const snap = await getDocs(
        collection(db, "stores", storeId, "walletBalances")
      );
      const openingBalances: Record<string, number> = {};
      snap.forEach((d) => {
        openingBalances[d.id] = (d.data().currentBalance as number) ?? 0;
      });
      if (Object.keys(openingBalances).length === 0) {
        toast.error(tw("noWallets"));
        return;
      }
      const cw = wallets.find((w) => w.type === "cash")?.id;
      const floatRaw = initialCashFloatStr.trim();
      if (cw && floatRaw !== "") {
        const n = Number(floatRaw);
        if (!Number.isNaN(n) && n >= 0) {
          openingBalances[cw] = n;
        }
      }
      const auth = getFirebaseAuth();
      await addDoc(collection(db, "stores", storeId, "shifts"), {
        cashierId: user.uid,
        cashierEmail: auth.currentUser?.email ?? "",
        status: "open",
        openingBalances,
        startedAt: serverTimestamp(),
      } as Omit<ShiftDoc, "startedAt"> & { startedAt: unknown });
      setInitialCashFloatStr("");
      toast.success(tc("save"));
    } catch (e) {
      console.error(e);
      toast.error(tc("error"));
    }
  }

  function resolvedFee(amount: number, w: WalletDoc | undefined): number {
    if (feeType === "manual") {
      const m = Number(manualFeeStr);
      return computeFee(amount, "manual", 0, 0, Number.isNaN(m) ? 0 : m);
    }
    if (!w) return 0;
    return computeFee(amount, feeType, w.defaultFeePercent, w.defaultFeeFixed);
  }

  async function addTransaction() {
    if (!storeId || !activeShift || !cashWalletId) return;
    const amount = Number(amountStr);
    if (Number.isNaN(amount) || amount <= 0) {
      toast.error(tc("required"));
      return;
    }

    let primaryId = walletId;
    let secondaryId: string | undefined;

    if (txType === "buy_cards") {
      primaryId = cashWalletId;
    } else if (txType === "transfer") {
      primaryId = walletId;
      secondaryId = secondaryWalletId;
      if (!secondaryId || secondaryId === primaryId) {
        toast.error(t("transferNeedTwoWallets"));
        return;
      }
    } else {
      const w = wallets.find((x) => x.id === primaryId);
      if (!w || w.type === "cash") {
        toast.error(t("pickOperationalWallet"));
        return;
      }
    }

    const feeWallet =
      txType === "buy_cards"
        ? wallets.find((x) => x.id === cashWalletId)
        : wallets.find((x) => x.id === primaryId);
    const fee = resolvedFee(amount, feeWallet);

    const effects = computeTransactionEffects(txType, amount, fee);

    const payload: Record<string, unknown> = {
      type: txType,
      walletId: primaryId,
      amount,
      fee,
      feeType,
      cashEffect: effects.cashEffect,
      walletEffect: effects.walletEffect,
      clientId: crypto.randomUUID(),
    };
    if (effects.secondaryWalletEffect != null && secondaryId) {
      payload.secondaryWalletId = secondaryId;
      payload.secondaryWalletEffect = effects.secondaryWalletEffect;
    }
    if (customerName.trim()) payload.customerName = customerName.trim();
    if (customerPhone.trim()) payload.customerPhone = customerPhone.trim();
    if (txNote.trim()) payload.note = txNote.trim();

    const deltas = aggregateTransactionBalanceDeltas(
      payload as unknown as TransactionDoc,
      cashWalletId
    );

    if (!online) {
      let transactionDocId: string | undefined;
      if (txPhotoFile) {
        const dbx = getDb();
        transactionDocId = doc(
          collection(
            dbx,
            "stores",
            storeId,
            "shifts",
            activeShift.id,
            "transactions"
          )
        ).id;
        await enqueuePendingAttachment({
          kind: "transactionPhoto",
          targetDocId: transactionDocId,
          storeId,
          shiftId: activeShift.id,
          fileName: txPhotoFile.name,
          blob: txPhotoFile,
        });
      }
      await enqueuePendingWrite({
        id: payload.clientId as string,
        storeId,
        shiftId: activeShift.id,
        collection: "transactions",
        payload: attachBalanceDeltas(payload, deltas),
        transactionDocId,
      });
      await refreshPending();
      setPendingQueuedRows((prev) => [
        ...prev,
        {
          clientId: payload.clientId as string,
          kind: "tx",
          createdAt: Date.now(),
          type: txType,
          walletId: primaryId,
          secondaryWalletId: secondaryId,
          amount,
          fee,
          hasPhotoQueued: Boolean(txPhotoFile),
        },
      ]);
      toast.message(tc("offline"));
      resetTxForm();
      return;
    }

    try {
      const db = getDb();
      const { id: txId } = await commitShiftTransaction(
        db,
        storeId,
        activeShift.id,
        payload,
        deltas
      );
      if (txPhotoFile) {
        const storage = getFirebaseStorage();
        const safeName = txPhotoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `stores/${storeId}/shifts/${activeShift.id}/transactions/${txId}_${safeName}`;
        const r = ref(storage, path);
        await uploadBytes(r, txPhotoFile, {
          contentType: txPhotoFile.type || "image/jpeg",
        });
        const photoUrl = await getDownloadURL(r);
        await updateDoc(
          doc(
            db,
            "stores",
            storeId,
            "shifts",
            activeShift.id,
            "transactions",
            txId
          ),
          { photoUrl }
        );
      }
      resetTxForm();
      toast.success(tc("save"));
    } catch (e) {
      console.error(e);
      toast.error(tc("error"));
    }
  }

  function resetTxForm() {
    setAmountStr("");
    setManualFeeStr("");
    setCustomerName("");
    setCustomerPhone("");
    setTxNote("");
    setTxPhotoFile(null);
  }

  async function addExpense() {
    if (!storeId || !activeShift) return;
    const amt = Number(expenseAmount);
    if (Number.isNaN(amt) || amt <= 0) {
      toast.error(tc("required"));
      return;
    }
    const clientId = crypto.randomUUID();
    let receiptUrl: string | undefined;
    let expenseDocId: string | undefined;

    try {
      if (receiptFile && online) {
        const storage = getFirebaseStorage();
        const safeName = receiptFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `stores/${storeId}/shifts/${activeShift.id}/expenses/${crypto.randomUUID()}_${safeName}`;
        const r = ref(storage, path);
        await uploadBytes(r, receiptFile, {
          contentType: receiptFile.type || "image/jpeg",
        });
        receiptUrl = await getDownloadURL(r);
      }

      const payload: Record<string, unknown> = {
        amount: amt,
        category: expenseCategory as ExpenseDoc["category"],
        clientId,
      };
      if (expenseNote.trim()) payload.note = expenseNote.trim();
      if (receiptUrl) payload.receiptUrl = receiptUrl;

      const deltas: Record<string, number> = {};
      if (cashWalletId) deltas[cashWalletId] = -amt;

      if (!online) {
        if (receiptFile) {
          const dbx = getDb();
          expenseDocId = doc(
            collection(
              dbx,
              "stores",
              storeId,
              "shifts",
              activeShift.id,
              "expenses"
            )
          ).id;
          await enqueuePendingReceipt({
            expenseDocId,
            storeId,
            shiftId: activeShift.id,
            fileName: receiptFile.name,
            blob: receiptFile,
          });
        }

        await enqueuePendingWrite({
          id: clientId,
          storeId,
          shiftId: activeShift.id,
          collection: "expenses",
          payload: attachBalanceDeltas(payload, deltas),
          expenseDocId,
        });
        await refreshPending();
        setPendingQueuedRows((prev) => [
          ...prev,
          {
            clientId,
            kind: "expense",
            createdAt: Date.now(),
            category: expenseCategory,
            amount: amt,
            hasReceiptQueued: Boolean(receiptFile),
          },
        ]);
        toast.message(tc("offline"));
        setExpenseAmount("");
        setExpenseNote("");
        setReceiptFile(null);
        return;
      }

      const db = getDb();
      await commitShiftExpense(
        db,
        storeId,
        activeShift.id,
        payload,
        cashWalletId,
        amt
      );
      setExpenseAmount("");
      setExpenseNote("");
      setReceiptFile(null);
      toast.success(tc("save"));
    } catch (e) {
      console.error(e);
      toast.error(tc("error"));
    }
  }

  async function submitRecharge() {
    if (!storeId || !activeShift || !cashWalletId) return;
    const amt = Number(rechargeAmountStr);
    if (Number.isNaN(amt) || amt <= 0 || !rechargeWalletId) {
      toast.error(tc("required"));
      return;
    }
    const { cashEffect, walletEffect } = computeRechargeEffects(
      amt,
      rechargeSource
    );
    const deltas: Record<string, number> = { [rechargeWalletId]: walletEffect };
    if (rechargeSource === "cash") deltas[cashWalletId] = cashEffect;

    const payload: Record<string, unknown> = {
      walletId: rechargeWalletId,
      shiftId: activeShift.id,
      amount: amt,
      source: rechargeSource,
      cashWalletId: rechargeSource === "cash" ? cashWalletId : undefined,
      clientId: crypto.randomUUID(),
    };

    if (!online) {
      const cid = payload.clientId as string;
      await enqueuePendingWrite({
        id: cid,
        storeId,
        shiftId: activeShift.id,
        collection: "walletRecharges",
        payload: attachBalanceDeltas(payload, deltas),
      });
      await refreshPending();
      setPendingQueuedRows((prev) => [
        ...prev,
        {
          clientId: cid,
          kind: "recharge",
          createdAt: Date.now(),
          walletId: rechargeWalletId,
          amount: amt,
          source: rechargeSource,
        },
      ]);
      toast.message(tc("offline"));
      setRechargeOpen(false);
      setRechargeAmountStr("");
      return;
    }

    try {
      const db = getDb();
      await commitWalletRecharge(db, storeId, payload, deltas);
      setRechargeOpen(false);
      setRechargeAmountStr("");
      toast.success(tc("save"));
    } catch (e) {
      console.error(e);
      toast.error(tc("error"));
    }
  }

  async function confirmCloseShift() {
    if (!storeId || !activeShift || !cashWalletId) return;

    const declared: Record<string, number> = {};
    for (const w of wallets) {
      const raw = declaredMap[w.id];
      if (raw !== undefined && raw !== "") {
        const n = Number(raw);
        if (!Number.isNaN(n)) declared[w.id] = n;
      }
    }

    const walletIds = wallets.map((w) => w.id);
    const opening = activeShift.openingBalances ?? {};
    const expected = computeExpectedBalances(
      opening,
      transactions,
      recharges,
      expenses,
      cashWalletId,
      expenseTotal
    );

    const discResult = computeDiscrepanciesForClose(
      expected,
      declared,
      walletIds
    );
    if (!discResult.ok) {
      toast.error(t("closeMissingDeclared"));
      return;
    }
    const { discrepancies } = discResult;

    const countsByType: Partial<Record<TransactionType, number>> = {};
    for (const tx of transactions) {
      countsByType[tx.type] = (countsByType[tx.type] ?? 0) + 1;
    }

    const note = handoverNoteClose.trim();
    const shiftClosePatch: Record<string, unknown> = {
      status: "closed",
      declaredBalances: declared,
      expectedBalances: expected,
      discrepancies,
      summary: {
        totalFees: feesThisShift,
        totalVolume: volumeThisShift,
        totalExpenses: expenseTotal,
        transactionCount: transactions.length,
        rechargeCount: recharges.length,
        countsByType,
      },
    };
    if (note) shiftClosePatch.handoverNote = note;

    try {
      if (!online) {
        await enqueuePendingWrite({
          id: crypto.randomUUID(),
          storeId,
          shiftId: activeShift.id,
          collection: "shiftClose",
          payload: { shiftClosePatch },
        });
        await refreshPending();
        toast.message(t("closeShiftQueuedOffline"));
        setCloseOpen(false);
        setDeclaredMap({});
        setHandoverNoteClose("");
        return;
      }

      const db = getDb();
      await updateDoc(doc(db, "stores", storeId, "shifts", activeShift.id), {
        ...shiftClosePatch,
        closedAt: serverTimestamp(),
      });

      setCloseOpen(false);
      setDeclaredMap({});
      setHandoverNoteClose("");
      toast.success(t("reportGenerated"));
    } catch (e) {
      console.error(e);
      toast.error(tc("error"));
    }
  }

  const previewAmount = Number(amountStr);
  const previewWallet =
    txType === "buy_cards"
      ? wallets.find((x) => x.id === cashWalletId)
      : wallets.find((x) => x.id === walletId);
  const previewFee =
    !Number.isNaN(previewAmount) && previewAmount > 0
      ? resolvedFee(previewAmount, previewWallet)
      : null;
  const previewEffects =
    previewFee != null && !Number.isNaN(previewAmount) && previewAmount > 0
      ? computeTransactionEffects(txType, previewAmount, previewFee)
      : null;

  const previewCashAfter =
    cashWalletId && previewEffects != null && previewFee != null
      ? (balances[cashWalletId] ?? 0) + previewEffects.cashEffect
      : null;

  const previewPrimaryWalletAfter =
    previewEffects != null && previewFee != null
      ? (() => {
          const wid = txType === "buy_cards" ? cashWalletId : walletId;
          if (!wid) return null;
          return (balances[wid] ?? 0) + previewEffects.walletEffect;
        })()
      : null;

  const previewSecondaryWalletAfter =
    previewEffects != null &&
    previewFee != null &&
    txType === "transfer" &&
    secondaryWalletId
      ? (balances[secondaryWalletId] ?? 0) +
        (previewEffects.secondaryWalletEffect ?? 0)
      : null;

  useEffect(() => {
    if (txType === "buy_cards" && cashWalletId) {
      setWalletId(cashWalletId);
    }
  }, [txType, cashWalletId]);

  const closeExpectedBalances =
    activeShift && cashWalletId
      ? computeExpectedBalances(
          activeShift.openingBalances ?? {},
          transactions,
          recharges,
          expenses,
          cashWalletId,
          expenseTotal
        )
      : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        {profile?.role === "cashier" ? (
          <p className="text-muted-foreground">{t("cashierOnlyStart")}</p>
        ) : null}
      </div>

      {activeShift && lowBalanceWarnings.length > 0 ? (
        <div
          className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm"
          role="status"
        >
          <p className="font-medium text-amber-900 dark:text-amber-100">
            {t("lowBalanceBannerTitle")}
          </p>
          <ul className="mt-2 list-inside list-disc text-muted-foreground">
            {lowBalanceWarnings.map((w) => (
              <li key={w.id}>
                {walletLabel(w)} — {formatMoney(balances[w.id] ?? 0, currency, moneyLocale)}{" "}
                ({tw("lowBalanceAlert")}{" "}
                {formatMoney(w.lowBalanceAlert ?? 0, currency, moneyLocale)})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!activeShift ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("startShift")}</CardTitle>
            <CardDescription>{t("startSnapshotHint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {lastClosedShift ? (
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <p className="font-medium">{t("lastShiftSummary")}</p>
                <p className="mt-1 text-muted-foreground">
                  {formatMoney(
                    lastClosedShift.summary?.totalVolume ?? 0,
                    currency,
                    moneyLocale
                  )}{" "}
                  · {t("feesThisShift")}{" "}
                  {formatMoney(
                    lastClosedShift.summary?.totalFees ?? 0,
                    currency,
                    moneyLocale
                  )}{" "}
                  · {t("expenses")}{" "}
                  {formatMoney(
                    lastClosedShift.summary?.totalExpenses ?? 0,
                    currency,
                    moneyLocale
                  )}
                </p>
              </div>
            ) : null}
            {cashWalletId ? (
              <div className="space-y-2 max-w-xs">
                <Label>{t("initialCashFloat")}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder={t("initialCashFloatHint")}
                  value={initialCashFloatStr}
                  onChange={(e) => setInitialCashFloatStr(e.target.value)}
                />
              </div>
            ) : null}
            <Button type="button" onClick={() => void startShift()}>
              {t("startShift")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="sticky top-0 z-30 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground">
                  {t("feesThisShift")}:{" "}
                  <strong className="text-foreground">
                    {formatMoney(feesThisShift, currency, moneyLocale)}
                  </strong>
                </span>
                <span className="text-muted-foreground">
                  {t("volumeThisShift")}:{" "}
                  <strong className="text-foreground">
                    {formatMoney(volumeThisShift, currency, moneyLocale)}
                  </strong>
                </span>
                <span className="text-muted-foreground">
                  {t("txnCount")}:{" "}
                  <strong className="text-foreground">{transactions.length}</strong>
                </span>
                <span className="text-muted-foreground">
                  {t("rechargesCount")}:{" "}
                  <strong className="text-foreground">{recharges.length}</strong>
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setRechargeOpen(true)}
                >
                  {t("walletRecharge")}
                </Button>
                <Button
                  variant="destructive"
                  type="button"
                  onClick={() => setCloseOpen(true)}
                >
                  {t("endShift")}
                </Button>
              </div>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("activeTitle")}</CardTitle>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {tc("status")}: <Badge variant="success">{tc("open")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {wallets.map((w) => (
                <div
                  key={w.id}
                  className="rounded-lg border bg-muted/40 p-3 text-sm"
                  style={{
                    borderInlineStartWidth: 4,
                    borderInlineStartColor: w.color,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {w.photoUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={w.photoUrl}
                          alt=""
                          className="h-8 w-8 rounded-md border object-cover"
                        />
                      ) : null}
                      <p className="font-medium">{walletLabel(w)}</p>
                    </div>
                    <Badge variant={balanceTone(w)}>
                      {formatMoney(balances[w.id] ?? 0, currency, moneyLocale)}
                    </Badge>
                  </div>
                  {w.type !== "cash" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full"
                      onClick={() => {
                        setRechargeWalletId(w.id);
                        setRechargeOpen(true);
                      }}
                    >
                      {t("walletRecharge")}
                    </Button>
                  ) : null}
                  {w.type !== "cash" && w.lowBalanceAlert != null ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tw("lowBalanceAlert")}:{" "}
                      {formatMoney(w.lowBalanceAlert, currency, moneyLocale)}
                    </p>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          {netChangeByWallet ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("netChange")}</CardTitle>
                <CardDescription>{t("netChangeHint")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                {wallets.map((w) => {
                  const delta = netChangeByWallet[w.id] ?? 0;
                  return (
                    <div
                      key={w.id}
                      className="rounded-md border px-3 py-2 text-sm"
                      style={{
                        borderInlineStartWidth: 3,
                        borderInlineStartColor: w.color,
                      }}
                    >
                      <span className="font-medium">{walletLabel(w)}</span>
                      <span
                        className={
                          delta >= 0 ? " ms-2 text-green-600" : " ms-2 text-destructive"
                        }
                      >
                        {delta >= 0 ? "+" : ""}
                        {formatMoney(delta, currency, moneyLocale)}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t("transactionTitle")}</CardTitle>
              <CardDescription>{t("transactionHint")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t("transactionType")}</Label>
                  <Select
                    value={txType}
                    onValueChange={(v) => setTxType(v as TransactionType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TX_TYPES.map((ty) => (
                        <SelectItem key={ty} value={ty}>
                          {t(`types.${ty}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {txType !== "buy_cards" ? (
                  <div className="space-y-2">
                    <Label>{t("primaryWallet")}</Label>
                    <Select value={walletId} onValueChange={setWalletId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {digitalWallets.map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {walletLabel(w)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {txType === "transfer" ? (
                  <div className="space-y-2">
                    <Label>{t("secondaryWallet")}</Label>
                    <Select value={secondaryWalletId} onValueChange={setSecondaryWalletId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {digitalWallets
                          .filter((w) => w.id !== walletId)
                          .map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {walletLabel(w)}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label>{t("principalAmount")}</Label>
                  <p className="text-xs text-muted-foreground">{t("quickAmounts")}</p>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_AMOUNTS.map((n) => (
                      <Button
                        key={n}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAmountStr(String(n))}
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                  />
                </div>

                <AttachmentField
                  file={txPhotoFile}
                  onChange={setTxPhotoFile}
                  label={t("transactionPhoto")}
                  hint={t("transactionPhotoHint")}
                  removeLabel={t("removeAttachment")}
                />

                <div className="space-y-2">
                  <Label>{t("feeType")}</Label>
                  <Select
                    value={feeType}
                    onValueChange={(v) => setFeeType(v as FeeType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">{t("feePercentPlusFixed")}</SelectItem>
                      <SelectItem value="fixed">{t("feeFixedOnly")}</SelectItem>
                      <SelectItem value="manual">{t("feeManual")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {feeType === "manual" ? (
                  <div className="space-y-2">
                    <Label>{t("feeAmount")}</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={manualFeeStr}
                      onChange={(e) => setManualFeeStr(e.target.value)}
                    />
                  </div>
                ) : null}

                {previewEffects != null && previewFee != null ? (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      {t("fee")}: {formatMoney(previewFee, currency, moneyLocale)} —{" "}
                      {t("cashDelta")}:{" "}
                      {formatMoney(previewEffects.cashEffect, currency, moneyLocale)} —{" "}
                      {t("walletDelta")}:{" "}
                      {formatMoney(previewEffects.walletEffect, currency, moneyLocale)}
                      {previewEffects.secondaryWalletEffect != null
                        ? ` — ${t("secondaryDelta")}: ${formatMoney(
                            previewEffects.secondaryWalletEffect,
                            currency,
                            moneyLocale
                          )}`
                        : ""}
                    </p>
                    {previewCashAfter != null ? (
                      <p>
                        {t("cashAfterTx")}:{" "}
                        {formatMoney(previewCashAfter, currency, moneyLocale)}
                      </p>
                    ) : null}
                    {previewPrimaryWalletAfter != null ? (
                      <p>
                        {t("walletAfterTx")}:{" "}
                        {formatMoney(previewPrimaryWalletAfter, currency, moneyLocale)}
                      </p>
                    ) : null}
                    {previewSecondaryWalletAfter != null ? (
                      <p>
                        {t("secondaryWalletAfterTx")}:{" "}
                        {formatMoney(
                          previewSecondaryWalletAfter,
                          currency,
                          moneyLocale
                        )}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label>{tc("notes")}</Label>
                  <Input value={txNote} onChange={(e) => setTxNote(e.target.value)} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0 text-muted-foreground"
                  onClick={() => setShowCustomerDetails((v) => !v)}
                >
                  {showCustomerDetails ? "− " : "+ "}
                  {t("customerDetails")}
                </Button>
                {showCustomerDetails ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{t("customerName")}</Label>
                      <Input
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("customerPhone")}</Label>
                      <Input
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                      />
                    </div>
                  </div>
                ) : null}
                <Button type="button" onClick={() => void addTransaction()}>
                  {t("addTransaction")}
                </Button>
              </div>

              <div className="space-y-4">
                <h3 className="font-semibold">{t("expensesTitle")}</h3>
                <div className="space-y-2">
                  <Label>{t("expenseAmount")}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("category")}</Label>
                  <Select value={expenseCategory} onValueChange={setExpenseCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="supplier">{t("categorySupplier")}</SelectItem>
                      <SelectItem value="supplies">{t("categorySupplies")}</SelectItem>
                      <SelectItem value="other">{t("categoryOther")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{tc("notes")}</Label>
                  <Textarea value={expenseNote} onChange={(e) => setExpenseNote(e.target.value)} />
                </div>
                <AttachmentField
                  file={receiptFile}
                  onChange={setReceiptFile}
                  label={t("receiptUpload")}
                  hint={t("transactionPhotoHint")}
                  removeLabel={t("removeAttachment")}
                />
                <Button type="button" variant="secondary" onClick={() => void addExpense()}>
                  {t("addExpense")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("transactions")}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">{t("photoCol")}</TableHead>
                    <TableHead>{tc("status")}</TableHead>
                    <TableHead>{t("transactionType")}</TableHead>
                    <TableHead>{t("wallet")}</TableHead>
                    <TableHead>{t("principalAmount")}</TableHead>
                    <TableHead>{t("fee")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingQueuedRows.filter((r) => r.kind === "tx").length === 0 &&
                  transactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6}>{tc("noData")}</TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {pendingQueuedRows
                        .filter((r): r is Extract<ShiftQueuedRow, { kind: "tx" }> => r.kind === "tx")
                        .sort((a, b) => b.createdAt - a.createdAt)
                        .map((row) => (
                          <TableRow key={`q-${row.clientId}`} className="bg-muted/50">
                            <TableCell>
                              {row.hasPhotoQueued ? (
                                <span className="text-xs text-muted-foreground">
                                  {t("photoQueued")}
                                </span>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{t("queuedSync")}</Badge>
                            </TableCell>
                            <TableCell>{t(`types.${row.type}`)}</TableCell>
                            <TableCell>
                              {walletLabel(
                                wallets.find((w) => w.id === row.walletId) ??
                                  ({
                                    id: row.walletId,
                                    nameEn: row.walletId,
                                    nameAr: row.walletId,
                                    type: "other",
                                    defaultFeePercent: 0,
                                    defaultFeeFixed: 0,
                                    color: "#999",
                                    icon: "",
                                    isActive: true,
                                    sortOrder: 0,
                                  } as WalletDoc & { id: string })
                              )}
                              {row.secondaryWalletId
                                ? ` → ${walletLabel(
                                    wallets.find((w) => w.id === row.secondaryWalletId) ??
                                      ({
                                        id: row.secondaryWalletId,
                                        nameEn: row.secondaryWalletId,
                                        nameAr: row.secondaryWalletId,
                                        type: "other",
                                        defaultFeePercent: 0,
                                        defaultFeeFixed: 0,
                                        color: "#999",
                                        icon: "",
                                        isActive: true,
                                        sortOrder: 0,
                                      } as WalletDoc & { id: string })
                                  )}`
                                : ""}
                            </TableCell>
                            <TableCell>
                              {formatMoney(row.amount, currency, moneyLocale)}
                            </TableCell>
                            <TableCell>
                              {formatMoney(row.fee, currency, moneyLocale)}
                            </TableCell>
                          </TableRow>
                        ))}
                      {transactions.map((tx) => (
                        <TableRow key={tx.id}>
                          <TableCell>
                            <AttachmentThumbnail
                              urls={tx.photoUrl ? [tx.photoUrl] : []}
                              title={t("transactionPhoto")}
                              prevLabel={t("prevAttachment")}
                              nextLabel={t("nextAttachment")}
                            />
                          </TableCell>
                          <TableCell>—</TableCell>
                          <TableCell>{t(`types.${tx.type}`)}</TableCell>
                          <TableCell>
                            {walletLabel(
                              wallets.find((w) => w.id === tx.walletId) ??
                                ({
                                  id: tx.walletId,
                                  nameEn: tx.walletId,
                                  nameAr: tx.walletId,
                                  type: "other",
                                  defaultFeePercent: 0,
                                  defaultFeeFixed: 0,
                                  color: "#999",
                                  icon: "",
                                  isActive: true,
                                  sortOrder: 0,
                                } as WalletDoc & { id: string })
                            )}
                            {tx.secondaryWalletId
                              ? ` → ${walletLabel(
                                  wallets.find((w) => w.id === tx.secondaryWalletId) ??
                                    ({
                                      id: tx.secondaryWalletId,
                                      nameEn: tx.secondaryWalletId,
                                      nameAr: tx.secondaryWalletId,
                                      type: "other",
                                      defaultFeePercent: 0,
                                      defaultFeeFixed: 0,
                                      color: "#999",
                                      icon: "",
                                      isActive: true,
                                      sortOrder: 0,
                                    } as WalletDoc & { id: string })
                                )}`
                              : ""}
                          </TableCell>
                          <TableCell>
                            {formatMoney(tx.amount, currency, moneyLocale)}
                          </TableCell>
                          <TableCell>
                            {formatMoney(tx.fee, currency, moneyLocale)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t("expenses")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">{t("photoCol")}</TableHead>
                      <TableHead>{tc("status")}</TableHead>
                      <TableHead>{t("category")}</TableHead>
                      <TableHead>{tc("amount")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingQueuedRows.filter((r) => r.kind === "expense").length === 0 &&
                    expenses.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4}>{tc("noData")}</TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {pendingQueuedRows
                          .filter((r): r is Extract<ShiftQueuedRow, { kind: "expense" }> => r.kind === "expense")
                          .sort((a, b) => b.createdAt - a.createdAt)
                          .map((row) => (
                            <TableRow key={`qe-${row.clientId}`} className="bg-muted/50">
                              <TableCell>
                                {row.hasReceiptQueued ? (
                                  <span className="text-xs text-muted-foreground">
                                    {t("photoQueued")}
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{t("queuedSync")}</Badge>
                              </TableCell>
                              <TableCell>
                                {row.category}
                                {row.hasReceiptQueued ? ` · ${t("receiptQueued")}` : ""}
                              </TableCell>
                              <TableCell>
                                {formatMoney(row.amount, currency, moneyLocale)}
                              </TableCell>
                            </TableRow>
                          ))}
                        {expenses.map((ex) => (
                          <TableRow key={ex.id}>
                            <TableCell>
                              <AttachmentThumbnail
                                urls={ex.receiptUrl ? [ex.receiptUrl] : []}
                                title={t("receiptUpload")}
                                prevLabel={t("prevAttachment")}
                                nextLabel={t("nextAttachment")}
                              />
                            </TableCell>
                            <TableCell>—</TableCell>
                            <TableCell>{ex.category}</TableCell>
                            <TableCell>
                              {formatMoney(ex.amount, currency, moneyLocale)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("rechargesTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tc("status")}</TableHead>
                      <TableHead>{t("wallet")}</TableHead>
                      <TableHead>{tc("amount")}</TableHead>
                      <TableHead>{t("rechargeSource")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingQueuedRows.filter((r) => r.kind === "recharge").length === 0 &&
                    recharges.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4}>{tc("noData")}</TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {pendingQueuedRows
                          .filter((r): r is Extract<ShiftQueuedRow, { kind: "recharge" }> => r.kind === "recharge")
                          .sort((a, b) => b.createdAt - a.createdAt)
                          .map((row) => (
                            <TableRow key={`qr-${row.clientId}`} className="bg-muted/50">
                              <TableCell>
                                <Badge variant="outline">{t("queuedSync")}</Badge>
                              </TableCell>
                              <TableCell>
                                {walletLabel(
                                  wallets.find((w) => w.id === row.walletId) ??
                                    ({
                                      id: row.walletId,
                                      nameEn: row.walletId,
                                      nameAr: row.walletId,
                                      type: "other",
                                      defaultFeePercent: 0,
                                      defaultFeeFixed: 0,
                                      color: "#999",
                                      icon: "",
                                      isActive: true,
                                      sortOrder: 0,
                                    } as WalletDoc & { id: string })
                                )}
                              </TableCell>
                              <TableCell>
                                {formatMoney(row.amount, currency, moneyLocale)}
                              </TableCell>
                              <TableCell>{t(`rechargeSources.${row.source}`)}</TableCell>
                            </TableRow>
                          ))}
                        {recharges.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>—</TableCell>
                            <TableCell>
                              {walletLabel(
                                wallets.find((w) => w.id === r.walletId) ??
                                  ({
                                    id: r.walletId,
                                    nameEn: r.walletId,
                                    nameAr: r.walletId,
                                    type: "other",
                                    defaultFeePercent: 0,
                                    defaultFeeFixed: 0,
                                    color: "#999",
                                    icon: "",
                                    isActive: true,
                                    sortOrder: 0,
                                  } as WalletDoc & { id: string })
                              )}
                            </TableCell>
                            <TableCell>
                              {formatMoney(r.amount, currency, moneyLocale)}
                            </TableCell>
                            <TableCell>{t(`rechargeSources.${r.source}`)}</TableCell>
                          </TableRow>
                        ))}
                      </>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Dialog open={rechargeOpen} onOpenChange={setRechargeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("walletRecharge")}</DialogTitle>
            <DialogDescription>{t("walletRechargeHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t("wallet")}</Label>
              <Select value={rechargeWalletId} onValueChange={setRechargeWalletId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {digitalWallets.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {walletLabel(w)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{tc("amount")}</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={rechargeAmountStr}
                onChange={(e) => setRechargeAmountStr(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("rechargeSource")}</Label>
              <Select
                value={rechargeSource}
                onValueChange={(v) => setRechargeSource(v as RechargeSource)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{t("rechargeSources.cash")}</SelectItem>
                  <SelectItem value="bank_transfer">
                    {t("rechargeSources.bank_transfer")}
                  </SelectItem>
                  <SelectItem value="distributor">
                    {t("rechargeSources.distributor")}
                  </SelectItem>
                  <SelectItem value="other">{t("rechargeSources.other")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setRechargeOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="button" onClick={() => void submitRecharge()}>
              {tc("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("endShift")}</DialogTitle>
            <DialogDescription>{t("declaredBalancesHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {closeExpectedBalances ? (
              <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                <p className="font-medium">{t("closeReconciliationPeek")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("closeReconciliationPeekHint")}
                </p>
              </div>
            ) : null}
            {wallets.map((w) => {
              const exp = closeExpectedBalances?.[w.id];
              const raw = declaredMap[w.id];
              const decl =
                raw !== undefined && raw !== "" && !Number.isNaN(Number(raw))
                  ? Number(raw)
                  : null;
              const delta =
                decl != null && exp != null
                  ? Math.round((decl - exp) * 100) / 100
                  : null;
              return (
                <div key={w.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label>
                      {t("declaredBalanceFor")} — {walletLabel(w)}
                    </Label>
                    {exp != null ? (
                      <span className="text-xs text-muted-foreground">
                        {t("expectedShort")}:{" "}
                        {formatMoney(exp, currency, moneyLocale)}
                      </span>
                    ) : null}
                  </div>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={declaredMap[w.id] ?? ""}
                    onChange={(e) =>
                      setDeclaredMap((prev) => ({
                        ...prev,
                        [w.id]: e.target.value,
                      }))
                    }
                  />
                  {delta != null ? (
                    <Badge variant={delta === 0 ? "secondary" : "destructive"}>
                      {t("declaredDelta")}:{" "}
                      {formatMoney(delta, currency, moneyLocale)}
                    </Badge>
                  ) : null}
                </div>
              );
            })}
            <div className="space-y-2">
              <Label>{t("handoverNoteClose")}</Label>
              <Textarea
                value={handoverNoteClose}
                onChange={(e) => setHandoverNoteClose(e.target.value)}
                placeholder={t("handoverNoteCloseHint")}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setCloseOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="button" onClick={() => void confirmCloseShift()}>
              {tc("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
