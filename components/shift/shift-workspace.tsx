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
import { computeExpectedBalances, computeDiscrepancies } from "@/lib/shift-math";
import {
  computeRechargeEffects,
  computeTransactionEffects,
} from "@/lib/transaction-effects";
import { formatMoney } from "@/lib/utils";
import { enqueuePendingWrite } from "@/lib/offline/sync";
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

  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<string>("supplier");
  const [expenseNote, setExpenseNote] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

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
    const auth = getFirebaseAuth();
    await addDoc(collection(db, "stores", storeId, "shifts"), {
      cashierId: user.uid,
      cashierEmail: auth.currentUser?.email ?? "",
      status: "open",
      openingBalances,
      startedAt: serverTimestamp(),
    } as Omit<ShiftDoc, "startedAt"> & { startedAt: unknown });
    toast.success(tc("save"));
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
      await enqueuePendingWrite({
        id: payload.clientId as string,
        storeId,
        shiftId: activeShift.id,
        collection: "transactions",
        payload: attachBalanceDeltas(payload, deltas),
      });
      await refreshPending();
      toast.message(tc("offline"));
      resetTxForm();
      return;
    }

    const db = getDb();
    await commitShiftTransaction(
      db,
      storeId,
      activeShift.id,
      payload,
      deltas
    );
    resetTxForm();
    toast.success(tc("save"));
  }

  function resetTxForm() {
    setAmountStr("");
    setManualFeeStr("");
    setCustomerName("");
    setCustomerPhone("");
    setTxNote("");
  }

  async function addExpense() {
    if (!storeId || !activeShift) return;
    const amt = Number(expenseAmount);
    if (Number.isNaN(amt) || amt <= 0) {
      toast.error(tc("required"));
      return;
    }
    let receiptUrl: string | undefined;
    if (receiptFile) {
      const storage = getFirebaseStorage();
      const path = `stores/${storeId}/shifts/${activeShift.id}/expenses/${crypto.randomUUID()}_${receiptFile.name}`;
      const r = ref(storage, path);
      await uploadBytes(r, receiptFile);
      receiptUrl = await getDownloadURL(r);
    }
    const payload: Record<string, unknown> = {
      amount: amt,
      category: expenseCategory as ExpenseDoc["category"],
      clientId: crypto.randomUUID(),
    };
    if (expenseNote.trim()) payload.note = expenseNote.trim();
    if (receiptUrl) payload.receiptUrl = receiptUrl;

    const deltas: Record<string, number> = {};
    if (cashWalletId) deltas[cashWalletId] = -amt;

    if (!online) {
      await enqueuePendingWrite({
        id: payload.clientId as string,
        storeId,
        shiftId: activeShift.id,
        collection: "expenses",
        payload: attachBalanceDeltas(payload, deltas),
      });
      await refreshPending();
      toast.message(tc("offline"));
      setExpenseAmount("");
      setExpenseNote("");
      setReceiptFile(null);
      return;
    }

    const db = getDb();
    await commitShiftExpense(db, storeId, activeShift.id, payload, cashWalletId, amt);
    setExpenseAmount("");
    setExpenseNote("");
    setReceiptFile(null);
    toast.success(tc("save"));
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
      await enqueuePendingWrite({
        id: payload.clientId as string,
        storeId,
        shiftId: activeShift.id,
        collection: "walletRecharges",
        payload: attachBalanceDeltas(payload, deltas),
      });
      await refreshPending();
      toast.message(tc("offline"));
      setRechargeOpen(false);
      setRechargeAmountStr("");
      return;
    }

    const db = getDb();
    await commitWalletRecharge(db, storeId, payload, deltas);
    setRechargeOpen(false);
    setRechargeAmountStr("");
    toast.success(tc("save"));
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

    const opening = activeShift.openingBalances ?? {};
    const expected = computeExpectedBalances(
      opening,
      transactions,
      recharges,
      expenses,
      cashWalletId,
      expenseTotal
    );

    const discrepancies = computeDiscrepancies(expected, declared);

    const countsByType: Partial<Record<TransactionType, number>> = {};
    for (const tx of transactions) {
      countsByType[tx.type] = (countsByType[tx.type] ?? 0) + 1;
    }

    const db = getDb();
    await updateDoc(doc(db, "stores", storeId, "shifts", activeShift.id), {
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
      closedAt: serverTimestamp(),
    });

    setCloseOpen(false);
    setDeclaredMap({});
    toast.success(t("reportGenerated"));
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

  useEffect(() => {
    if (txType === "buy_cards" && cashWalletId) {
      setWalletId(cashWalletId);
    }
  }, [txType, cashWalletId]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        {profile?.role === "cashier" ? (
          <p className="text-muted-foreground">{t("cashierOnlyStart")}</p>
        ) : null}
      </div>

      {!activeShift ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("startShift")}</CardTitle>
            <CardDescription>{t("startSnapshotHint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <Button type="button" onClick={() => void startShift()}>
              {t("startShift")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("feesThisShift")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">
                {formatMoney(feesThisShift, currency, moneyLocale)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("volumeThisShift")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">
                {formatMoney(volumeThisShift, currency, moneyLocale)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("txnCount")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">
                {transactions.length}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("rechargesCount")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">
                {recharges.length}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>{t("activeTitle")}</CardTitle>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {tc("status")}: <Badge variant="success">{tc("open")}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" type="button" onClick={() => setRechargeOpen(true)}>
                  {t("walletRecharge")}
                </Button>
                <Button variant="destructive" type="button" onClick={() => setCloseOpen(true)}>
                  {t("endShift")}
                </Button>
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
                    <p className="font-medium">{walletLabel(w)}</p>
                    <Badge variant={balanceTone(w)}>
                      {formatMoney(balances[w.id] ?? 0, currency, moneyLocale)}
                    </Badge>
                  </div>
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
                        {(txType === "transfer" ? digitalWallets : digitalWallets).map(
                          (w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {walletLabel(w)}
                            </SelectItem>
                          )
                        )}
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
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                  />
                </div>

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
                  <p className="text-xs text-muted-foreground">
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
                ) : null}

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t("customerName")}</Label>
                    <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("customerPhone")}</Label>
                    <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{tc("notes")}</Label>
                  <Input value={txNote} onChange={(e) => setTxNote(e.target.value)} />
                </div>
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
                <div className="space-y-2">
                  <Label>{t("receiptUpload")}</Label>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                  />
                </div>
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
                    <TableHead>{t("transactionType")}</TableHead>
                    <TableHead>{t("wallet")}</TableHead>
                    <TableHead>{t("principalAmount")}</TableHead>
                    <TableHead>{t("fee")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4}>{tc("noData")}</TableCell>
                    </TableRow>
                  ) : (
                    transactions.map((tx) => (
                      <TableRow key={tx.id}>
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
                    ))
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
                      <TableHead>{t("category")}</TableHead>
                      <TableHead>{tc("amount")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={2}>{tc("noData")}</TableCell>
                      </TableRow>
                    ) : (
                      expenses.map((ex) => (
                        <TableRow key={ex.id}>
                          <TableCell>{ex.category}</TableCell>
                          <TableCell>
                            {formatMoney(ex.amount, currency, moneyLocale)}
                          </TableCell>
                        </TableRow>
                      ))
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
                      <TableHead>{t("wallet")}</TableHead>
                      <TableHead>{tc("amount")}</TableHead>
                      <TableHead>{t("rechargeSource")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recharges.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3}>{tc("noData")}</TableCell>
                      </TableRow>
                    ) : (
                      recharges.map((r) => (
                        <TableRow key={r.id}>
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
                      ))
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
            {wallets.map((w) => (
              <div key={w.id} className="space-y-2">
                <Label>
                  {t("declaredBalanceFor")} — {walletLabel(w)}
                </Label>
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
              </div>
            ))}
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
