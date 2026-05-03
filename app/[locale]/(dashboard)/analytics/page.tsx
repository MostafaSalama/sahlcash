"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { Timestamp } from "firebase/firestore";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { AdminGate } from "@/components/admin-gate";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { getDb } from "@/lib/firebase/client";
import { downloadCsv } from "@/lib/csv";
import { formatMoney } from "@/lib/utils";
import type { ShiftDoc, TransactionDoc, WalletDoc } from "@/types/firestore";

const PIE_COLORS = [
  "#4f46e5",
  "#dc2626",
  "#0d9488",
  "#ea580c",
  "#7c3aed",
  "#64748b",
];

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDayFromStr(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 0, 0, 0, 0);
}

function endOfDayFromStr(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 23, 59, 59, 999);
}

function shiftClosedDate(s: ShiftDoc): Date | null {
  if (!s.closedAt) return null;
  return s.closedAt instanceof Timestamp ? s.closedAt.toDate() : new Date();
}

export default function AnalyticsPage() {
  const t = useTranslations("analytics");
  const ts = useTranslations("shift");
  const tc = useTranslations("common");
  const locale = useLocale();
  const moneyLocale = locale === "ar" ? "ar-EG" : "en-US";
  const { storeId, store } = useAuth();

  const [dateFromStr, setDateFromStr] = useState(() => {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 30);
    return isoDate(start);
  });
  const [dateToStr, setDateToStr] = useState(() => isoDate(new Date()));

  const [cashierKey, setCashierKey] = useState<string>("__all__");
  const [shifts, setShifts] = useState<(ShiftDoc & { id: string })[]>([]);
  const [wallets, setWallets] = useState<(WalletDoc & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [walletFeeAgg, setWalletFeeAgg] = useState<Record<string, number>>({});
  const [feeAggLoading, setFeeAggLoading] = useState(false);

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const db = getDb();
        const q = query(
          collection(db, "stores", storeId, "shifts"),
          orderBy("startedAt", "desc"),
          limit(400)
        );
        const snap = await getDocs(q);
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as ShiftDoc),
        }));
        const wSnap = await getDocs(
          collection(db, "stores", storeId, "wallets")
        );
        const wRows = wSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as WalletDoc),
        }));
        if (!cancelled) {
          setShifts(rows);
          setWallets(wRows);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.error(tc("error"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, tc]);

  const currency = store?.currency ?? "EGP";

  const rangeStart = useMemo(() => startOfDayFromStr(dateFromStr), [dateFromStr]);
  const rangeEnd = useMemo(() => endOfDayFromStr(dateToStr), [dateToStr]);

  const closedInRange = useMemo(() => {
    return shifts.filter((s) => {
      if (s.status !== "closed" || !s.closedAt) return false;
      const cd = shiftClosedDate(s);
      if (!cd) return false;
      return cd >= rangeStart && cd <= rangeEnd;
    });
  }, [shifts, rangeStart, rangeEnd]);

  const cashierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of closedInRange) {
      set.add(s.cashierEmail ?? s.cashierId);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [closedInRange]);

  useEffect(() => {
    if (cashierKey === "__all__") return;
    if (!cashierOptions.includes(cashierKey)) setCashierKey("__all__");
  }, [cashierKey, cashierOptions]);

  const filtered = useMemo(() => {
    if (cashierKey === "__all__") return closedInRange;
    return closedInRange.filter(
      (s) => (s.cashierEmail ?? s.cashierId) === cashierKey
    );
  }, [closedInRange, cashierKey]);

  useEffect(() => {
    if (!storeId || filtered.length === 0) {
      setWalletFeeAgg({});
      return;
    }
    let cancelled = false;
    (async () => {
      setFeeAggLoading(true);
      try {
        const db = getDb();
        const agg: Record<string, number> = {};
        for (const s of filtered) {
          const snap = await getDocs(
            collection(
              db,
              "stores",
              storeId,
              "shifts",
              s.id,
              "transactions"
            )
          );
          for (const d of snap.docs) {
            const tx = d.data() as TransactionDoc;
            agg[tx.walletId] = (agg[tx.walletId] ?? 0) + (tx.fee ?? 0);
          }
        }
        if (!cancelled) setWalletFeeAgg(agg);
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.error(tc("error"));
      } finally {
        if (!cancelled) setFeeAggLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, filtered, tc]);

  const walletLabel = useCallback(
    (id: string) => {
      const w = wallets.find((x) => x.id === id);
      if (!w) return id;
      return locale === "ar" ? w.nameAr || w.nameEn : w.nameEn || w.nameAr;
    },
    [wallets, locale]
  );

  const cashierLeaderboard = useMemo(() => {
    const m = new Map<
      string,
      {
        fees: number;
        volume: number;
        expenses: number;
        absDisc: number;
        shifts: number;
      }
    >();
    for (const s of closedInRange) {
      const key = s.cashierEmail ?? s.cashierId;
      const prev = m.get(key) ?? {
        fees: 0,
        volume: 0,
        expenses: 0,
        absDisc: 0,
        shifts: 0,
      };
      prev.fees += s.summary?.totalFees ?? 0;
      prev.volume += s.summary?.totalVolume ?? 0;
      prev.expenses += s.summary?.totalExpenses ?? 0;
      prev.shifts += 1;
      if (s.discrepancies) {
        for (const v of Object.values(s.discrepancies)) {
          prev.absDisc += Math.abs(v);
        }
      }
      m.set(key, prev);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].fees - a[1].fees);
  }, [closedInRange]);

  const feesByWalletChart = useMemo(() => {
    const total = Object.values(walletFeeAgg).reduce((a, b) => a + b, 0);
    const rows = Object.entries(walletFeeAgg)
      .map(([walletId, fees]) => ({
        name: walletLabel(walletId),
        fees,
        pct: total > 0 ? Math.round((fees / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.fees - a.fees)
      .slice(0, 14);
    return rows;
  }, [walletFeeAgg, walletLabel]);

  const applyPreset = (days: number) => {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    setDateFromStr(isoDate(start));
    setDateToStr(isoDate(new Date()));
  };

  const exportAnalyticsCsv = () => {
    const header = [
      "shiftId",
      "closedDay",
      "cashier",
      "fees",
      "volume",
      "expenses",
      "transactions",
    ];
    const rows = filtered.map((s) => {
      const cd = shiftClosedDate(s);
      return [
        s.id,
        cd ? cd.toISOString().slice(0, 10) : "",
        s.cashierEmail ?? s.cashierId,
        s.summary?.totalFees ?? 0,
        s.summary?.totalVolume ?? 0,
        s.summary?.totalExpenses ?? 0,
        s.summary?.transactionCount ?? 0,
      ];
    });
    downloadCsv(`sahl-analytics-${dateFromStr}-${dateToStr}.csv`, [
      header,
      ...rows,
    ]);
  };

  const kpis = useMemo(() => {
    let totalFees = 0;
    let totalVolume = 0;
    let totalExpenses = 0;
    let totalTx = 0;
    let totalRecharges = 0;
    const n = filtered.length;
    for (const s of filtered) {
      totalFees += s.summary?.totalFees ?? 0;
      totalVolume += s.summary?.totalVolume ?? 0;
      totalExpenses += s.summary?.totalExpenses ?? 0;
      totalTx += s.summary?.transactionCount ?? 0;
      totalRecharges += s.summary?.rechargeCount ?? 0;
    }
    return {
      shiftsClosed: n,
      avgFeesPerShift: n ? totalFees / n : 0,
      totalFees,
      totalVolume,
      totalExpenses,
      totalTx,
      totalRecharges,
      netAfterPetty: totalFees - totalExpenses,
    };
  }, [filtered]);

  const dailySeries = useMemo(() => {
    const map = new Map<
      string,
      {
        day: string;
        fees: number;
        volume: number;
        expenses: number;
        shiftCount: number;
      }
    >();
    for (const s of filtered) {
      const cd = shiftClosedDate(s);
      if (!cd) continue;
      const key = cd.toISOString().slice(0, 10);
      const prev =
        map.get(key) ??
        ({
          day: key,
          fees: 0,
          volume: 0,
          expenses: 0,
          shiftCount: 0,
        } as const);
      map.set(key, {
        day: key,
        fees: prev.fees + (s.summary?.totalFees ?? 0),
        volume: prev.volume + (s.summary?.totalVolume ?? 0),
        expenses: prev.expenses + (s.summary?.totalExpenses ?? 0),
        shiftCount: prev.shiftCount + 1,
      });
    }
    return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [filtered]);

  const discrepancySeries = useMemo(() => {
    const map = new Map<string, { day: string; absDisc: number }>();
    for (const s of filtered) {
      const cd = shiftClosedDate(s);
      if (!cd) continue;
      const key = cd.toISOString().slice(0, 10);
      let disc = 0;
      if (s.discrepancies) {
        for (const v of Object.values(s.discrepancies)) {
          disc += Math.abs(v);
        }
      }
      const prev = map.get(key) ?? { day: key, absDisc: 0 };
      prev.absDisc += disc;
      map.set(key, prev);
    }
    return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [filtered]);

  const typePieData = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of filtered) {
      const c = s.summary?.countsByType;
      if (!c) continue;
      for (const [k, v] of Object.entries(c)) {
        m[k] = (m[k] ?? 0) + (v ?? 0);
      }
    }
    return Object.entries(m).map(([typeKey, value]) => ({
      name: ts(`types.${typeKey}`),
      value,
      typeKey,
    }));
  }, [filtered, ts]);

  const fmtMoneyAxis = (v: number) =>
    formatMoney(v, currency, moneyLocale).replace(/\s/g, " ");

  const pieEmpty = !loading && typePieData.length === 0;

  return (
    <AdminGate>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground">{t("subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => applyPreset(7)}>
              {t("range7")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => applyPreset(30)}>
              {t("range30")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => applyPreset(90)}>
              {t("range90")}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={exportAnalyticsCsv}>
              {t("exportCsv")}
            </Button>
            <Select value={cashierKey} onValueChange={(v) => setCashierKey(v)}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder={t("filterCashier")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("allCashiers")}</SelectItem>
                {cashierOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("dateRangeTitle")}</CardTitle>
            <CardDescription>{t("dateRangeHint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>{t("dateFrom")}</Label>
              <Input
                type="date"
                value={dateFromStr}
                onChange={(e) => setDateFromStr(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("dateTo")}</Label>
              <Input
                type="date"
                value={dateToStr}
                onChange={(e) => setDateToStr(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("kpiShiftsClosed")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {loading ? <Skeleton className="h-9 w-16" /> : kpis.shiftsClosed}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("kpiAvgFees")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {loading ? (
                <Skeleton className="h-9 w-36" />
              ) : (
                formatMoney(kpis.avgFeesPerShift, currency, moneyLocale)
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("kpiTotalExpenses")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {loading ? (
                <Skeleton className="h-9 w-36" />
              ) : (
                formatMoney(kpis.totalExpenses, currency, moneyLocale)
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("kpiNetAfterPetty")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {loading ? (
                <Skeleton className="h-9 w-36" />
              ) : (
                formatMoney(kpis.netAfterPetty, currency, moneyLocale)
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("kpiTotalTransactions")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {loading ? <Skeleton className="h-9 w-20" /> : kpis.totalTx}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("kpiTotalRecharges")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {loading ? (
                <Skeleton className="h-9 w-20" />
              ) : (
                kpis.totalRecharges
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("cashierLeaderboard")}</CardTitle>
            <CardDescription>{t("cashierLeaderboardHint")}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("filterCashier")}</TableHead>
                  <TableHead className="text-end">{t("kpiShiftsClosed")}</TableHead>
                  <TableHead className="text-end">{t("totalFeesCol")}</TableHead>
                  <TableHead className="text-end">{t("totalVolumeCol")}</TableHead>
                  <TableHead className="text-end">{t("kpiTotalExpenses")}</TableHead>
                  <TableHead className="text-end">{t("absDiscCol")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashierLeaderboard.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>{tc("noData")}</TableCell>
                  </TableRow>
                ) : (
                  cashierLeaderboard.map(([name, v]) => (
                    <TableRow key={name}>
                      <TableCell>{name}</TableCell>
                      <TableCell className="text-end">{v.shifts}</TableCell>
                      <TableCell className="text-end font-mono text-sm">
                        {formatMoney(v.fees, currency, moneyLocale)}
                      </TableCell>
                      <TableCell className="text-end font-mono text-sm">
                        {formatMoney(v.volume, currency, moneyLocale)}
                      </TableCell>
                      <TableCell className="text-end font-mono text-sm">
                        {formatMoney(v.expenses, currency, moneyLocale)}
                      </TableCell>
                      <TableCell className="text-end font-mono text-sm">
                        {formatMoney(v.absDisc, currency, moneyLocale)}
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
            <CardTitle>{t("feesByWalletTitle")}</CardTitle>
            <CardDescription>{t("feesByWalletHint")}</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {feeAggLoading || loading ? (
              <Skeleton className="mx-auto mt-8 h-48 w-full max-w-lg" />
            ) : feesByWalletChart.length === 0 ? (
              <p>{tc("noData")}</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={feesByWalletChart} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={fmtMoneyAxis} />
                  <YAxis type="category" dataKey="name" width={120} />
                  <Tooltip
                    formatter={(value, _name, item) => [
                      `${formatMoney(Number(value ?? 0), currency, moneyLocale)} (${(item?.payload as { pct?: number })?.pct ?? 0}%)`,
                      t("feeLeakageLabel"),
                    ]}
                  />
                  <Bar dataKey="fees" fill="#7c3aed" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dailyProfit")}</CardTitle>
            <CardDescription>{t("dailyProfitHint")}</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {loading ? (
              <p>{tc("loading")}</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailySeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" hide />
                  <YAxis tickFormatter={fmtMoneyAxis} width={88} />
                  <Tooltip
                    formatter={(value) =>
                      formatMoney(Number(value ?? 0), currency, moneyLocale)
                    }
                  />
                  <Bar dataKey="fees" fill="#4f46e5" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dailyVolume")}</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {loading ? (
              <p>{tc("loading")}</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailySeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis tickFormatter={fmtMoneyAxis} width={88} />
                  <Tooltip
                    formatter={(value) =>
                      formatMoney(Number(value ?? 0), currency, moneyLocale)
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="volume"
                    stroke="#0d9488"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("transactionTypeMix")}</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {loading ? (
              <p>{tc("loading")}</p>
            ) : pieEmpty ? (
              <p>{tc("noData")}</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={typePieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label
                  >
                    {typePieData.map((entry, i) => (
                      <Cell
                        key={entry.typeKey}
                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("discrepancyTrend")}</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {loading ? (
              <p>{tc("loading")}</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={discrepancySeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis tickFormatter={fmtMoneyAxis} width={88} />
                  <Tooltip
                    formatter={(value) =>
                      formatMoney(Number(value ?? 0), currency, moneyLocale)
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="absDisc"
                    stroke="#dc2626"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dailyExpenses")}</CardTitle>
            <CardDescription>{t("dailyExpensesHint")}</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {loading ? (
              <p>{tc("loading")}</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailySeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis tickFormatter={fmtMoneyAxis} width={88} />
                  <Tooltip
                    formatter={(value) =>
                      formatMoney(Number(value ?? 0), currency, moneyLocale)
                    }
                  />
                  <Bar
                    dataKey="expenses"
                    fill="#ea580c"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("shiftsPerDay")}</CardTitle>
            <CardDescription>{t("shiftsPerDayHint")}</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {loading ? (
              <p>{tc("loading")}</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailySeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis allowDecimals={false} width={48} />
                  <Tooltip />
                  <Bar
                    dataKey="shiftCount"
                    fill="#64748b"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminGate>
  );
}
