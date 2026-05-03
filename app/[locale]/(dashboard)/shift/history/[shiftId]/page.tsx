"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AttachmentThumbnail } from "@/components/shift/attachment-thumbnail";
import { useAuth } from "@/contexts/auth-context";
import { getDb } from "@/lib/firebase/client";
import { buildShiftLedgerLines } from "@/lib/build-shift-ledger-lines";
import { downloadShiftLedgerPdf } from "@/lib/pdf-shift-report";
import { downloadCsv } from "@/lib/csv";
import { cn, formatMoney } from "@/lib/utils";
import type {
  CorrectionDoc,
  ExpenseDoc,
  ShiftDoc,
  TransactionDoc,
  WalletDoc,
  WalletRechargeDoc,
} from "@/types/firestore";

const PAGE_SIZE = 50;

function fmtDate(ts: Timestamp | undefined, locale: string) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString(locale === "ar" ? "ar-EG" : "en-US");
}

export default function ShiftDetailPage() {
  const params = useParams();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const printMode = searchParams.get("print") === "1";
  const shiftId = typeof params.shiftId === "string" ? params.shiftId : "";
  const t = useTranslations("shift");
  const td = useTranslations("shift.detail");
  const tc = useTranslations("common");
  const locale = useLocale();
  const moneyLocale = locale === "ar" ? "ar-EG" : "en-US";
  const { storeId, store, profile, user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [shift, setShift] = useState<(ShiftDoc & { id: string }) | null>(null);
  const [wallets, setWallets] = useState<(WalletDoc & { id: string })[]>([]);
  const [transactions, setTransactions] = useState<
    (TransactionDoc & { id: string })[]
  >([]);
  const [expenses, setExpenses] = useState<(ExpenseDoc & { id: string })[]>(
    []
  );
  const [recharges, setRecharges] = useState<
    (WalletRechargeDoc & { id: string })[]
  >([]);
  const [corrections, setCorrections] = useState<
    (CorrectionDoc & { id: string })[]
  >([]);

  const [lastTx, setLastTx] = useState<QueryDocumentSnapshot | null>(null);
  const [lastEx, setLastEx] = useState<QueryDocumentSnapshot | null>(null);
  const [txHasMore, setTxHasMore] = useState(false);
  const [exHasMore, setExHasMore] = useState(false);
  const [loadingMoreTx, setLoadingMoreTx] = useState(false);
  const [loadingMoreEx, setLoadingMoreEx] = useState(false);

  const reloadShiftData = useCallback(async () => {
    if (!storeId || !shiftId) return;
    const db = getDb();
    const shiftRef = doc(db, "stores", storeId, "shifts", shiftId);
    const txCol = collection(
      db,
      "stores",
      storeId,
      "shifts",
      shiftId,
      "transactions"
    );
    const exCol = collection(
      db,
      "stores",
      storeId,
      "shifts",
      shiftId,
      "expenses"
    );

    const txQ = query(txCol, orderBy("createdAt", "desc"), limit(PAGE_SIZE));
    const exQ = query(exCol, orderBy("createdAt", "desc"), limit(PAGE_SIZE));
    const corrQ = query(
      collection(db, "stores", storeId, "corrections"),
      where("shiftId", "==", shiftId),
      orderBy("createdAt", "desc"),
      limit(100)
    );

    const [shiftSnap, walletsSnap, txSnap, exSnap, rechargeSnap, corrSnap] =
      await Promise.all([
        getDoc(shiftRef),
        getDocs(collection(db, "stores", storeId, "wallets")),
        getDocs(txQ),
        getDocs(exQ),
        getDocs(
          query(
            collection(db, "stores", storeId, "walletRecharges"),
            where("shiftId", "==", shiftId)
          )
        ),
        getDocs(corrQ),
      ]);

    if (!shiftSnap.exists()) {
      setShift(null);
      setWallets([]);
      setTransactions([]);
      setExpenses([]);
      setRecharges([]);
      setCorrections([]);
      setLastTx(null);
      setLastEx(null);
      setTxHasMore(false);
      setExHasMore(false);
      return;
    }

    setShift({ id: shiftSnap.id, ...(shiftSnap.data() as ShiftDoc) });
    setWallets(
      walletsSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as WalletDoc),
      }))
    );
    setTransactions(
      txSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as TransactionDoc),
      }))
    );
    setLastTx(txSnap.docs.length ? txSnap.docs[txSnap.docs.length - 1]! : null);
    setTxHasMore(txSnap.docs.length === PAGE_SIZE);

    setExpenses(
      exSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as ExpenseDoc),
      }))
    );
    setLastEx(exSnap.docs.length ? exSnap.docs[exSnap.docs.length - 1]! : null);
    setExHasMore(exSnap.docs.length === PAGE_SIZE);

    const rechRows = rechargeSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as WalletRechargeDoc),
    }));
    rechRows.sort((a, b) => {
      const ta =
        a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : 0;
      const tb =
        b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    setRecharges(rechRows);

    setCorrections(
      corrSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as CorrectionDoc),
      }))
    );
  }, [storeId, shiftId]);

  useEffect(() => {
    if (!storeId || !shiftId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await reloadShiftData();
      } catch (e) {
        console.error(e);
        toast.error(tc("error"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, shiftId, reloadShiftData, tc]);

  const printOnceRef = useRef(false);
  useEffect(() => {
    if (!printMode) printOnceRef.current = false;
  }, [printMode]);
  useEffect(() => {
    if (!printMode || loading || !shift || printOnceRef.current) return;
    printOnceRef.current = true;
    const id = window.setTimeout(() => window.print(), 400);
    return () => clearTimeout(id);
  }, [printMode, loading, shift]);

  const currency = store?.currency ?? "EGP";

  const txPhotoGallery = useMemo(
    () =>
      transactions
        .map((x) => x.photoUrl)
        .filter((u): u is string => Boolean(u)),
    [transactions]
  );

  const expenseReceiptGallery = useMemo(
    () =>
      expenses
        .map((x) => x.receiptUrl)
        .filter((u): u is string => Boolean(u)),
    [expenses]
  );

  const walletLabel = useMemo(() => {
    return (id: string) => {
      const w = wallets.find((x) => x.id === id);
      if (!w) return id;
      return locale === "ar" ? w.nameAr || w.nameEn : w.nameEn || w.nameAr;
    };
  }, [wallets, locale]);

  async function downloadPdf() {
    if (!shift) return;
    try {
      const fmt = (n: number) => formatMoney(n, currency, moneyLocale);
      const lines = buildShiftLedgerLines(shift, walletLabel, fmt);
      await downloadShiftLedgerPdf({
        title: `SahlCash shift ${shift.id}`,
        locale,
        lines,
      });
    } catch (e) {
      console.error(e);
      toast.error(tc("error"));
    }
  }

  function exportDetailCsv() {
    if (!shift) return;
    const rows: (string | number)[][] = [];
    rows.push([`shift_${shift.id}`]);
    rows.push([]);
    rows.push(["transactions"]);
    rows.push(["id", "time", "type", "wallet", "amount", "fee", "photoUrl"]);
    for (const tx of transactions) {
      const ts =
        tx.createdAt instanceof Timestamp
          ? tx.createdAt.toDate().toISOString()
          : "";
      rows.push([
        tx.id,
        ts,
        tx.type,
        walletLabel(tx.walletId),
        tx.amount,
        tx.fee,
        tx.photoUrl ?? "",
      ]);
    }
    rows.push([]);
    rows.push(["expenses"]);
    rows.push(["id", "time", "category", "amount", "note", "receiptUrl"]);
    for (const ex of expenses) {
      const ts =
        ex.createdAt instanceof Timestamp
          ? ex.createdAt.toDate().toISOString()
          : "";
      rows.push([
        ex.id,
        ts,
        ex.category,
        ex.amount,
        ex.note ?? "",
        ex.receiptUrl ?? "",
      ]);
    }
    downloadCsv(`shift-${shift.id}-detail.csv`, rows);
  }

  async function loadMoreTx() {
    if (!storeId || !shiftId || !lastTx || loadingMoreTx) return;
    setLoadingMoreTx(true);
    try {
      const db = getDb();
      const txCol = collection(
        db,
        "stores",
        storeId,
        "shifts",
        shiftId,
        "transactions"
      );
      const txQ = query(
        txCol,
        orderBy("createdAt", "desc"),
        startAfter(lastTx),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(txQ);
      const next = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as TransactionDoc),
      }));
      setTransactions((prev) => [...prev, ...next]);
      setLastTx(snap.docs.length ? snap.docs[snap.docs.length - 1]! : lastTx);
      setTxHasMore(snap.docs.length === PAGE_SIZE);
    } catch (e) {
      console.error(e);
      toast.error(tc("error"));
    } finally {
      setLoadingMoreTx(false);
    }
  }

  async function loadMoreEx() {
    if (!storeId || !shiftId || !lastEx || loadingMoreEx) return;
    setLoadingMoreEx(true);
    try {
      const db = getDb();
      const exCol = collection(
        db,
        "stores",
        storeId,
        "shifts",
        shiftId,
        "expenses"
      );
      const exQ = query(
        exCol,
        orderBy("createdAt", "desc"),
        startAfter(lastEx),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(exQ);
      const next = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as ExpenseDoc),
      }));
      setExpenses((prev) => [...prev, ...next]);
      setLastEx(snap.docs.length ? snap.docs[snap.docs.length - 1]! : lastEx);
      setExHasMore(snap.docs.length === PAGE_SIZE);
    } catch (e) {
      console.error(e);
      toast.error(tc("error"));
    } finally {
      setLoadingMoreEx(false);
    }
  }

  async function markReconciled() {
    if (!storeId || !shift || !user || profile?.role !== "admin") return;
    try {
      const db = getDb();
      await updateDoc(doc(db, "stores", storeId, "shifts", shift.id), {
        reconciledAt: serverTimestamp(),
        reconciledBy: user.uid,
      });
      setShift({
        ...shift,
        reconciledBy: user.uid,
        reconciledAt: Timestamp.now(),
      });
      toast.success(tc("save"));
    } catch (e) {
      console.error(e);
      toast.error(tc("error"));
    }
  }

  const balanceRows = useMemo(() => {
    if (!shift) return [];
    const ids = new Set<string>();
    for (const k of Object.keys(shift.openingBalances ?? {})) ids.add(k);
    for (const k of Object.keys(shift.expectedBalances ?? {})) ids.add(k);
    for (const k of Object.keys(shift.declaredBalances ?? {})) ids.add(k);
    for (const k of Object.keys(shift.discrepancies ?? {})) ids.add(k);
    return Array.from(ids);
  }, [shift]);

  if (!shiftId) {
    return (
      <div className="mx-auto max-w-6xl p-4">
        <p className="text-muted-foreground">{td("shiftNotFound")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" className="-ms-2 w-fit" asChild>
            <Link href="/shift/history">{td("backToHistory")}</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{td("title")}</h1>
          <p className="font-mono text-sm text-muted-foreground">{shiftId}</p>
        </div>
        {shift?.status === "closed" ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void downloadPdf()}>
              {td("downloadPdf")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                router.push(`${pathname}?print=1`)
              }
            >
              {tc("print")}
            </Button>
            <Button type="button" variant="outline" onClick={exportDetailCsv}>
              {td("exportCsv")}
            </Button>
            {profile?.role === "admin" &&
            shift &&
            !shift.reconciledAt &&
            shift.status === "closed" ? (
              <Button type="button" onClick={() => void markReconciled()}>
                {td("markReconciled")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading ? (
        <Card>
          <CardContent className="space-y-3 py-10">
            <Skeleton className="h-8 w-full max-w-md" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      ) : !shift ? (
        <Card>
          <CardContent className="py-10">
            <p className="text-muted-foreground">{td("shiftNotFound")}</p>
            <Button className="mt-4" variant="outline" asChild>
              <Link href="/shift/history">{td("backToHistory")}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={shift.status === "open" ? "warning" : "secondary"}>
              {shift.status === "open" ? tc("open") : tc("closed")}
            </Badge>
            {shift.reconciledAt ? (
              <Badge variant="success">{td("reconciled")}</Badge>
            ) : null}
            <span className="text-sm text-muted-foreground">
              {shift.cashierEmail ?? shift.cashierId}
            </span>
          </div>

          {shift.handoverNote?.trim() ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{td("handoverTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{shift.handoverNote.trim()}</p>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("volumeThisShift")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-semibold">
                {formatMoney(
                  shift.summary?.totalVolume ?? 0,
                  currency,
                  moneyLocale
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("feesThisShift")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-semibold">
                {formatMoney(
                  shift.summary?.totalFees ?? 0,
                  currency,
                  moneyLocale
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("expenses")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-semibold">
                {formatMoney(
                  shift.summary?.totalExpenses ?? 0,
                  currency,
                  moneyLocale
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("txnCount")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-semibold">
                {shift.summary?.transactionCount ?? transactions.length}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{td("schedule")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-8 text-sm">
              <div>
                <p className="text-muted-foreground">{t("openedAt")}</p>
                <p className="font-medium">
                  {fmtDate(shift.startedAt as Timestamp, locale)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("closedAt")}</p>
                <p className="font-medium">
                  {shift.closedAt
                    ? fmtDate(shift.closedAt as Timestamp, locale)
                    : "—"}
                </p>
              </div>
            </CardContent>
          </Card>

          {balanceRows.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{td("netWalletCardTitle")}</CardTitle>
                <CardDescription>{td("netWalletCardHint")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {balanceRows.map((wid) => {
                  const open = shift.openingBalances?.[wid] ?? 0;
                  const exp = shift.expectedBalances?.[wid];
                  const decl = shift.declaredBalances?.[wid];
                  const disc = shift.discrepancies?.[wid];
                  const tot =
                    Math.abs(open) +
                      Math.abs(exp ?? 0) +
                      Math.abs(decl ?? 0) ||
                    1;
                  const discNum = disc ?? 0;
                  return (
                    <div key={wid} className="space-y-2 border-b pb-4 last:border-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{walletLabel(wid)}</span>
                        {shift.discrepancies && disc !== undefined ? (
                          Math.abs(discNum) > 1e-9 ? (
                            <Badge variant="destructive">
                              {td("disc")}{" "}
                              {formatMoney(discNum, currency, moneyLocale)}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">OK</Badge>
                          )
                        ) : null}
                      </div>
                      <div className="flex h-2.5 w-full max-w-xl overflow-hidden rounded-full bg-muted">
                        <div
                          className="bg-sky-500/90"
                          style={{
                            width: `${(Math.abs(open) / tot) * 100}%`,
                          }}
                          title={`${td("opening")}`}
                        />
                        <div
                          className="bg-emerald-500/90"
                          style={{
                            width: `${(Math.abs(exp ?? 0) / tot) * 100}%`,
                          }}
                          title={`${td("expected")}`}
                        />
                        <div
                          className="bg-amber-500/90"
                          style={{
                            width: `${(Math.abs(decl ?? 0) / tot) * 100}%`,
                          }}
                          title={`${td("declared")}`}
                        />
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {td("opening")}:{" "}
                          {formatMoney(open, currency, moneyLocale)}
                        </span>
                        <span>
                          {td("expected")}:{" "}
                          {exp != null
                            ? formatMoney(exp, currency, moneyLocale)
                            : "—"}
                        </span>
                        <span>
                          {td("declared")}:{" "}
                          {decl != null
                            ? formatMoney(decl, currency, moneyLocale)
                            : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          {balanceRows.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{td("balancesTitle")}</CardTitle>
                <CardDescription>{td("balancesHint")}</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("wallet")}</TableHead>
                      <TableHead className="text-end">{td("opening")}</TableHead>
                      <TableHead className="text-end">{td("expected")}</TableHead>
                      <TableHead className="text-end">{td("declared")}</TableHead>
                      <TableHead className="text-end">{td("disc")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balanceRows.map((wid) => (
                      <TableRow key={wid}>
                        <TableCell>{walletLabel(wid)}</TableCell>
                        <TableCell className="text-end font-mono text-sm">
                          {formatMoney(
                            shift.openingBalances?.[wid] ?? 0,
                            currency,
                            moneyLocale
                          )}
                        </TableCell>
                        <TableCell className="text-end font-mono text-sm">
                          {shift.expectedBalances
                            ? formatMoney(
                                shift.expectedBalances[wid] ?? 0,
                                currency,
                                moneyLocale
                              )
                            : "—"}
                        </TableCell>
                        <TableCell className="text-end font-mono text-sm">
                          {shift.declaredBalances
                            ? formatMoney(
                                shift.declaredBalances[wid] ?? 0,
                                currency,
                                moneyLocale
                              )
                            : "—"}
                        </TableCell>
                        <TableCell className="text-end font-mono text-sm">
                          {shift.discrepancies &&
                          shift.discrepancies[wid] !== undefined
                            ? formatMoney(
                                shift.discrepancies[wid] ?? 0,
                                currency,
                                moneyLocale
                              )
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          <Tabs
            defaultValue="transactions"
            className={printMode ? "shift-detail-print-tabs" : undefined}
          >
            <TabsList
              className={cn(
                "flex flex-wrap h-auto gap-1",
                printMode && "hidden"
              )}
            >
              <TabsTrigger value="transactions">
                {td("tabTransactions")} ({transactions.length})
              </TabsTrigger>
              <TabsTrigger value="expenses">
                {td("tabExpenses")} ({expenses.length})
              </TabsTrigger>
              <TabsTrigger value="recharges">
                {td("tabRecharges")} ({recharges.length})
              </TabsTrigger>
              <TabsTrigger value="corrections">
                {td("tabCorrections")} ({corrections.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="transactions"
              forceMount
              className={cn(
                "mt-4",
                printMode ? "block" : "data-[state=inactive]:hidden"
              )}
            >
              <Card>
                <CardContent className="space-y-4 pt-6">
                  {transactions.length === 0 ? (
                    <p className="text-muted-foreground">{tc("noData")}</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-14">{t("photoCol")}</TableHead>
                          <TableHead>{td("time")}</TableHead>
                          <TableHead>{t("transactionType")}</TableHead>
                          <TableHead>{t("wallet")}</TableHead>
                          <TableHead className="text-end">{td("amount")}</TableHead>
                          <TableHead className="text-end">{t("fee")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {transactions.map((tx) => (
                          <TableRow key={tx.id}>
                            <TableCell>
                              <AttachmentThumbnail
                                urls={tx.photoUrl ? [tx.photoUrl] : []}
                                lightboxUrls={
                                  txPhotoGallery.length ? txPhotoGallery : undefined
                                }
                                lightboxIndex={
                                  tx.photoUrl
                                    ? txPhotoGallery.indexOf(tx.photoUrl)
                                    : 0
                                }
                                title={t("transactionPhoto")}
                                prevLabel={t("prevAttachment")}
                                nextLabel={t("nextAttachment")}
                              />
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              {fmtDate(tx.createdAt as Timestamp, locale)}
                            </TableCell>
                            <TableCell>{t(`types.${tx.type}`)}</TableCell>
                            <TableCell>{walletLabel(tx.walletId)}</TableCell>
                            <TableCell className="text-end font-mono text-sm">
                              {formatMoney(tx.amount, currency, moneyLocale)}
                            </TableCell>
                            <TableCell className="text-end font-mono text-sm">
                              {formatMoney(tx.fee, currency, moneyLocale)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {txHasMore ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loadingMoreTx}
                      onClick={() => void loadMoreTx()}
                    >
                      {td("loadMore")}
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent
              value="expenses"
              forceMount
              className={cn(
                "mt-4",
                printMode ? "block" : "data-[state=inactive]:hidden"
              )}
            >
              <Card>
                <CardContent className="space-y-4 pt-6">
                  {expenses.length === 0 ? (
                    <p className="text-muted-foreground">{tc("noData")}</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{td("receipt")}</TableHead>
                          <TableHead>{td("time")}</TableHead>
                          <TableHead>{td("category")}</TableHead>
                          <TableHead className="text-end">{td("amount")}</TableHead>
                          <TableHead>{td("note")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {expenses.map((ex) => (
                          <TableRow key={ex.id}>
                            <TableCell>
                              <AttachmentThumbnail
                                urls={ex.receiptUrl ? [ex.receiptUrl] : []}
                                lightboxUrls={
                                  expenseReceiptGallery.length
                                    ? expenseReceiptGallery
                                    : undefined
                                }
                                lightboxIndex={
                                  ex.receiptUrl
                                    ? expenseReceiptGallery.indexOf(ex.receiptUrl)
                                    : 0
                                }
                                title={t("receiptUpload")}
                                prevLabel={t("prevAttachment")}
                                nextLabel={t("nextAttachment")}
                              />
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              {fmtDate(ex.createdAt as Timestamp, locale)}
                            </TableCell>
                            <TableCell>
                              {ex.category === "supplier"
                                ? t("categorySupplier")
                                : ex.category === "supplies"
                                  ? t("categorySupplies")
                                  : t("categoryOther")}
                            </TableCell>
                            <TableCell className="text-end font-mono text-sm">
                              {formatMoney(ex.amount, currency, moneyLocale)}
                            </TableCell>
                            <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                              {ex.note ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {exHasMore ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loadingMoreEx}
                      onClick={() => void loadMoreEx()}
                    >
                      {td("loadMore")}
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent
              value="recharges"
              forceMount
              className={cn(
                "mt-4",
                printMode ? "block" : "data-[state=inactive]:hidden"
              )}
            >
              <Card>
                <CardContent className="pt-6">
                  {recharges.length === 0 ? (
                    <p className="text-muted-foreground">{tc("noData")}</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{td("time")}</TableHead>
                          <TableHead>{t("wallet")}</TableHead>
                          <TableHead>{td("source")}</TableHead>
                          <TableHead className="text-end">{td("amount")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recharges.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="whitespace-nowrap text-sm">
                              {fmtDate(r.createdAt as Timestamp, locale)}
                            </TableCell>
                            <TableCell>{walletLabel(r.walletId)}</TableCell>
                            <TableCell>
                              {t(`rechargeSources.${r.source}`)}
                            </TableCell>
                            <TableCell className="text-end font-mono text-sm">
                              {formatMoney(r.amount, currency, moneyLocale)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent
              value="corrections"
              forceMount
              className={cn(
                "mt-4",
                printMode ? "block" : "data-[state=inactive]:hidden"
              )}
            >
              <Card>
                <CardContent className="pt-6">
                  {corrections.length === 0 ? (
                    <p className="text-muted-foreground">{tc("noData")}</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{td("time")}</TableHead>
                          <TableHead>{td("correctionAmount")}</TableHead>
                          <TableHead>{td("correctionWallet")}</TableHead>
                          <TableHead>{td("correctionReason")}</TableHead>
                          <TableHead>{td("correctionAdmin")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {corrections.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell className="whitespace-nowrap text-sm">
                              {fmtDate(c.createdAt as Timestamp, locale)}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {formatMoney(c.amount, currency, moneyLocale)}
                            </TableCell>
                            <TableCell>
                              {c.walletId ? walletLabel(c.walletId) : "—"}
                            </TableCell>
                            <TableCell className="max-w-xs text-sm">
                              {c.reason}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {c.adminId}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
