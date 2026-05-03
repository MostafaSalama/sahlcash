"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { Timestamp } from "firebase/firestore";
import { Link } from "@/i18n/navigation";
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
import { useAuth } from "@/contexts/auth-context";
import { getDb } from "@/lib/firebase/client";
import { buildShiftLedgerLines } from "@/lib/build-shift-ledger-lines";
import { downloadShiftLedgerPdf } from "@/lib/pdf-shift-report";
import { formatMoney } from "@/lib/utils";
import type {
  ExpenseDoc,
  ShiftDoc,
  TransactionDoc,
  WalletDoc,
  WalletRechargeDoc,
} from "@/types/firestore";

function fmtDate(ts: Timestamp | undefined, locale: string) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString(locale === "ar" ? "ar-EG" : "en-US");
}

export default function ShiftDetailPage() {
  const params = useParams();
  const shiftId = typeof params.shiftId === "string" ? params.shiftId : "";
  const t = useTranslations("shift");
  const td = useTranslations("shift.detail");
  const tc = useTranslations("common");
  const locale = useLocale();
  const moneyLocale = locale === "ar" ? "ar-EG" : "en-US";
  const { storeId, store } = useAuth();

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

  useEffect(() => {
    if (!storeId || !shiftId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const db = getDb();
        const [shiftSnap, walletsSnap, txSnap, exSnap, rechargeSnap] =
          await Promise.all([
            getDoc(doc(db, "stores", storeId, "shifts", shiftId)),
            getDocs(collection(db, "stores", storeId, "wallets")),
            getDocs(
              query(
                collection(
                  db,
                  "stores",
                  storeId,
                  "shifts",
                  shiftId,
                  "transactions"
                ),
                orderBy("createdAt", "desc")
              )
            ),
            getDocs(
              query(
                collection(
                  db,
                  "stores",
                  storeId,
                  "shifts",
                  shiftId,
                  "expenses"
                ),
                orderBy("createdAt", "desc")
              )
            ),
            getDocs(
              query(
                collection(db, "stores", storeId, "walletRecharges"),
                where("shiftId", "==", shiftId)
              )
            ),
          ]);

        if (cancelled) return;

        if (!shiftSnap.exists()) {
          setShift(null);
          setWallets([]);
          setTransactions([]);
          setExpenses([]);
          setRecharges([]);
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
        setExpenses(
          exSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as ExpenseDoc),
          }))
        );
        const rechRows = rechargeSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as WalletRechargeDoc),
        }));
        rechRows.sort((a, b) => {
          const ta =
            a.createdAt instanceof Timestamp
              ? a.createdAt.toMillis()
              : 0;
          const tb =
            b.createdAt instanceof Timestamp
              ? b.createdAt.toMillis()
              : 0;
          return tb - ta;
        });
        setRecharges(rechRows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, shiftId]);

  const currency = store?.currency ?? "EGP";

  const walletLabel = useMemo(() => {
    return (id: string) => {
      const w = wallets.find((x) => x.id === id);
      if (!w) return id;
      return locale === "ar" ? w.nameAr || w.nameEn : w.nameEn || w.nameAr;
    };
  }, [wallets, locale]);

  function downloadPdf() {
    if (!shift) return;
    const fmt = (n: number) => formatMoney(n, currency, moneyLocale);
    const lines = buildShiftLedgerLines(shift, walletLabel, fmt);
    downloadShiftLedgerPdf({
      title: `SahlCash shift ${shift.id}`,
      locale,
      lines,
    });
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
          <Button type="button" variant="outline" onClick={() => downloadPdf()}>
            {td("downloadPdf")}
          </Button>
        ) : null}
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-10">{tc("loading")}</CardContent>
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
            <Badge
              variant={shift.status === "open" ? "warning" : "secondary"}
            >
              {shift.status === "open" ? tc("open") : tc("closed")}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {shift.cashierEmail ?? shift.cashierId}
            </span>
          </div>

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

          <Tabs defaultValue="transactions">
            <TabsList>
              <TabsTrigger value="transactions">
                {td("tabTransactions")} ({transactions.length})
              </TabsTrigger>
              <TabsTrigger value="expenses">
                {td("tabExpenses")} ({expenses.length})
              </TabsTrigger>
              <TabsTrigger value="recharges">
                {td("tabRecharges")} ({recharges.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="transactions" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  {transactions.length === 0 ? (
                    <p className="text-muted-foreground">{tc("noData")}</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
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
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="expenses" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  {expenses.length === 0 ? (
                    <p className="text-muted-foreground">{tc("noData")}</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{td("time")}</TableHead>
                          <TableHead>{td("category")}</TableHead>
                          <TableHead className="text-end">{td("amount")}</TableHead>
                          <TableHead>{td("note")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {expenses.map((ex) => (
                          <TableRow key={ex.id}>
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
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="recharges" className="mt-4">
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
          </Tabs>
        </>
      )}
    </div>
  );
}
