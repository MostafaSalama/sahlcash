"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { getDb } from "@/lib/firebase/client";
import { downloadCsv } from "@/lib/csv";
import { formatMoney } from "@/lib/utils";
import type { ShiftDoc } from "@/types/firestore";

const PAGE_SIZE = 50;

type ChipFilter = "all" | "open" | "closed" | "reconciled" | "hasDisc";

function fmtDate(ts: Timestamp | undefined, locale: string) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString(locale === "ar" ? "ar-EG" : "en-US");
}

function shiftStartedDay(ts: unknown): string {
  if (!(ts instanceof Timestamp)) return "";
  return ts.toDate().toISOString().slice(0, 10);
}

function shiftHasNonZeroDisc(s: ShiftDoc): boolean {
  const d = s.discrepancies ?? {};
  return Object.values(d).some(
    (v) => typeof v === "number" && Math.abs(v) > 1e-9
  );
}

export default function ShiftHistoryPage() {
  const t = useTranslations("shift");
  const td = useTranslations("shift.detail");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const moneyLocale = locale === "ar" ? "ar-EG" : "en-US";
  const { storeId, store } = useAuth();
  const [rows, setRows] = useState<(ShiftDoc & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState("");
  const [chipFilter, setChipFilter] = useState<ChipFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [cashierLabels, setCashierLabels] = useState<Record<string, string>>(
    {}
  );
  const [lastVisible, setLastVisible] = useState<QueryDocumentSnapshot | null>(
    null
  );
  const [hasMore, setHasMore] = useState(false);

  const loadInitial = useCallback(async () => {
    if (!storeId) return;
    const db = getDb();
    const q = query(
      collection(db, "stores", storeId, "shifts"),
      orderBy("startedAt", "desc"),
      limit(PAGE_SIZE)
    );
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as ShiftDoc),
    }));
    setRows(list);
    setLastVisible(snap.docs.length ? snap.docs[snap.docs.length - 1]! : null);
    setHasMore(snap.docs.length === PAGE_SIZE);
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadInitial();
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
  }, [storeId, loadInitial, tc]);

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    (async () => {
      try {
        const db = getDb();
        const snap = await getDocs(
          collection(db, "stores", storeId, "users")
        );
        const m: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          const name = String(data.displayName ?? "").trim();
          m[d.id] = name || String(data.email ?? "") || d.id;
        });
        if (!cancelled) setCashierLabels(m);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  async function loadMore() {
    if (!storeId || !lastVisible || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const db = getDb();
      const q = query(
        collection(db, "stores", storeId, "shifts"),
        orderBy("startedAt", "desc"),
        startAfter(lastVisible),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as ShiftDoc),
      }));
      setRows((prev) => [...prev, ...list]);
      setLastVisible(
        snap.docs.length ? snap.docs[snap.docs.length - 1]! : lastVisible
      );
      setHasMore(snap.docs.length === PAGE_SIZE);
    } catch (e) {
      console.error(e);
      toast.error(tc("error"));
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = useMemo(() => {
    let list = rows;
    if (chipFilter === "open") list = list.filter((r) => r.status === "open");
    else if (chipFilter === "closed")
      list = list.filter((r) => r.status === "closed");
    else if (chipFilter === "reconciled")
      list = list.filter((r) => !!r.reconciledAt);
    else if (chipFilter === "hasDisc") list = list.filter(shiftHasNonZeroDisc);

    if (dateFrom) {
      list = list.filter((r) => shiftStartedDay(r.startedAt) >= dateFrom);
    }
    if (dateTo) {
      list = list.filter((r) => shiftStartedDay(r.startedAt) <= dateTo);
    }

    const q = filter.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const label = cashierLabels[r.cashierId] ?? "";
        return (
          r.cashierEmail?.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          label.toLowerCase().includes(q) ||
          r.cashierId.toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [rows, chipFilter, dateFrom, dateTo, filter, cashierLabels]);

  const footerTotals = useMemo(() => {
    return filtered.reduce(
      (acc, s) => ({
        volume: acc.volume + (s.summary?.totalVolume ?? 0),
        expenses: acc.expenses + (s.summary?.totalExpenses ?? 0),
        fees: acc.fees + (s.summary?.totalFees ?? 0),
      }),
      { volume: 0, expenses: 0, fees: 0 }
    );
  }, [filtered]);

  const currency = store?.currency ?? "EGP";

  function exportHistoryCsv() {
    const header = [
      "id",
      "status",
      "cashier",
      "openedAt",
      "closedAt",
      "volume",
      "expenses",
      "fees",
      "reconciled",
    ];
    const lines = filtered.map((s) => {
      const opened =
        s.startedAt instanceof Timestamp
          ? s.startedAt.toDate().toISOString()
          : "";
      const closed =
        s.closedAt instanceof Timestamp
          ? s.closedAt.toDate().toISOString()
          : "";
      return [
        s.id,
        s.status,
        s.cashierEmail ?? s.cashierId,
        opened,
        closed,
        s.summary?.totalVolume ?? 0,
        s.summary?.totalExpenses ?? 0,
        s.summary?.totalFees ?? 0,
        s.reconciledAt ? "yes" : "no",
      ];
    });
    downloadCsv(`shift-history-${new Date().toISOString().slice(0, 10)}.csv`, [
      header,
      ...lines,
    ]);
  }

  function cashierCell(s: ShiftDoc & { id: string }) {
    const name = cashierLabels[s.cashierId];
    if (name && s.cashierEmail && name !== s.cashierEmail) {
      return (
        <span>
          {name}
          <span className="block text-xs text-muted-foreground">
            {s.cashierEmail}
          </span>
        </span>
      );
    }
    return name ?? s.cashierEmail ?? s.cashierId;
  }

  const chipBtn = (id: ChipFilter, label: string) => (
    <Button
      type="button"
      size="sm"
      variant={chipFilter === id ? "default" : "outline"}
      onClick={() => setChipFilter(id)}
    >
      {label}
    </Button>
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("historyTitle")}</h1>
          <p className="text-muted-foreground">{tc("search")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="max-w-xs"
            placeholder={tc("search")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!filtered.length}
            onClick={exportHistoryCsv}
          >
            {td("exportCsv")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {chipBtn("all", t("filterAll"))}
        {chipBtn("open", t("filterOpen"))}
        {chipBtn("closed", t("filterClosed"))}
        {chipBtn("reconciled", t("filterReconciled"))}
        {chipBtn("hasDisc", t("filterHasDisc"))}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("dateFrom")}</label>
          <Input
            type="date"
            className="w-auto"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("dateTo")}</label>
          <Input
            type="date"
            className="w-auto"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("historyTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc("status")}</TableHead>
                <TableHead>{t("cashier")}</TableHead>
                <TableHead>{t("openedAt")}</TableHead>
                <TableHead>{t("closedAt")}</TableHead>
                <TableHead>{t("volumeThisShift")}</TableHead>
                <TableHead>{t("expenses")}</TableHead>
                <TableHead>{t("feesTotal")}</TableHead>
                <TableHead>{td("reconciled")}</TableHead>
                <TableHead className="w-[1%]">{td("viewDetails")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9}>{tc("noData")}</TableCell>
                </TableRow>
              ) : (
                filtered.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/shift/history/${s.id}`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {shiftHasNonZeroDisc(s) ? (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-destructive"
                            title={t("hasDiscrepancies")}
                          />
                        ) : (
                          <span className="w-2 shrink-0" aria-hidden />
                        )}
                        <Badge
                          variant={
                            s.status === "open" ? "warning" : "secondary"
                          }
                        >
                          {s.status === "open" ? tc("open") : tc("closed")}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>{cashierCell(s)}</TableCell>
                    <TableCell>
                      {fmtDate(s.startedAt as Timestamp, locale)}
                    </TableCell>
                    <TableCell>
                      {s.closedAt
                        ? fmtDate(s.closedAt as Timestamp, locale)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {formatMoney(
                        s.summary?.totalVolume ?? 0,
                        currency,
                        moneyLocale
                      )}
                    </TableCell>
                    <TableCell>
                      {formatMoney(
                        s.summary?.totalExpenses ?? 0,
                        currency,
                        moneyLocale
                      )}
                    </TableCell>
                    <TableCell>
                      {formatMoney(
                        s.summary?.totalFees ?? 0,
                        currency,
                        moneyLocale
                      )}
                    </TableCell>
                    <TableCell>
                      {s.reconciledAt ? (
                        <Badge variant="success">{td("reconciled")}</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/shift/history/${s.id}`}>
                          {td("viewDetails")}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {!loading && filtered.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-6 border-t pt-4 text-sm">
              <span className="text-muted-foreground">{t("historyTotals")}:</span>
              <span>
                {t("volumeThisShift")}{" "}
                <strong>
                  {formatMoney(footerTotals.volume, currency, moneyLocale)}
                </strong>
              </span>
              <span>
                {t("expenses")}{" "}
                <strong>
                  {formatMoney(footerTotals.expenses, currency, moneyLocale)}
                </strong>
              </span>
              <span>
                {t("feesTotal")}{" "}
                <strong>
                  {formatMoney(footerTotals.fees, currency, moneyLocale)}
                </strong>
              </span>
            </div>
          ) : null}
          {!loading && hasMore ? (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                variant="outline"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {td("loadMore")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
