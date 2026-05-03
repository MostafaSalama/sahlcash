"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { getDb } from "@/lib/firebase/client";
import { formatMoney } from "@/lib/utils";
import type { ShiftDoc } from "@/types/firestore";

const PIE_COLORS = [
  "#4f46e5",
  "#dc2626",
  "#0d9488",
  "#ea580c",
  "#7c3aed",
  "#64748b",
];

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function AnalyticsPage() {
  const t = useTranslations("analytics");
  const ts = useTranslations("shift");
  const tc = useTranslations("common");
  const locale = useLocale();
  const moneyLocale = locale === "ar" ? "ar-EG" : "en-US";
  const { storeId, store } = useAuth();
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [cashierKey, setCashierKey] = useState<string>("__all__");
  const [shifts, setShifts] = useState<(ShiftDoc & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);

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
        if (!cancelled) setShifts(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const currency = store?.currency ?? "EGP";

  const since = useMemo(() => daysAgo(range), [range]);

  const closedInRange = useMemo(() => {
    return shifts.filter((s) => {
      if (s.status !== "closed" || !s.closedAt) return false;
      const cd =
        s.closedAt instanceof Timestamp ? s.closedAt.toDate() : new Date();
      return cd >= since;
    });
  }, [shifts, since]);

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
      const cd =
        s.closedAt instanceof Timestamp ? s.closedAt.toDate() : new Date();
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
      const cd =
        s.closedAt instanceof Timestamp ? s.closedAt.toDate() : new Date();
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

  return (
    <AdminGate>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground">{t("subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([7, 30, 90] as const).map((d) => (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={range === d ? "default" : "outline"}
                onClick={() => setRange(d)}
              >
                {d === 7 ? t("range7") : d === 30 ? t("range30") : t("range90")}
              </Button>
            ))}
            <Select
              value={cashierKey}
              onValueChange={(v) => setCashierKey(v)}
            >
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

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("kpiShiftsClosed")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {loading ? "…" : kpis.shiftsClosed}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("kpiAvgFees")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {loading
                ? "…"
                : formatMoney(kpis.avgFeesPerShift, currency, moneyLocale)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("kpiTotalExpenses")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {loading
                ? "…"
                : formatMoney(kpis.totalExpenses, currency, moneyLocale)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("kpiNetAfterPetty")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {loading
                ? "…"
                : formatMoney(kpis.netAfterPetty, currency, moneyLocale)}
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
              {loading ? "…" : kpis.totalTx}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("kpiTotalRecharges")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {loading ? "…" : kpis.totalRecharges}
            </CardContent>
          </Card>
        </div>

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
            {loading || typePieData.length === 0 ? (
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
