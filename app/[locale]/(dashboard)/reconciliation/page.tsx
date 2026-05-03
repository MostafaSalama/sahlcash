"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  addDoc,
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { Timestamp } from "firebase/firestore";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";
import { getDb } from "@/lib/firebase/client";
import { formatMoney } from "@/lib/utils";
import { buildShiftLedgerLines } from "@/lib/build-shift-ledger-lines";
import { downloadShiftLedgerPdf } from "@/lib/pdf-shift-report";
import type { ShiftDoc, WalletDoc } from "@/types/firestore";

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function ReconciliationPage() {
  const t = useTranslations("reconciliation");
  const ts = useTranslations("shift");
  const tc = useTranslations("common");
  const locale = useLocale();
  const moneyLocale = locale === "ar" ? "ar-EG" : "en-US";
  const { storeId, store, user } = useAuth();

  const [dateStr, setDateStr] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [shifts, setShifts] = useState<(ShiftDoc & { id: string })[]>([]);
  const [wallets, setWallets] = useState<(WalletDoc & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);

  const [corrShiftId, setCorrShiftId] = useState<string>("");
  const [corrAmount, setCorrAmount] = useState("");
  const [corrReason, setCorrReason] = useState("");

  useEffect(() => {
    if (!storeId) return;
    const db = getDb();
    const unsub = onSnapshot(
      collection(db, "stores", storeId, "wallets"),
      (snap) =>
        setWallets(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as WalletDoc),
          }))
        )
    );
    return () => unsub();
  }, [storeId]);

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
          limit(120)
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

  const selectedDate = useMemo(() => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y!, m! - 1, d!);
  }, [dateStr]);

  const dayShifts = useMemo(() => {
    return shifts.filter((s) => {
      if (s.status !== "closed" || !s.closedAt) return false;
      const cd =
        s.closedAt instanceof Timestamp
          ? s.closedAt.toDate()
          : new Date();
      return sameDay(cd, selectedDate);
    });
  }, [shifts, selectedDate]);

  const currency = store?.currency ?? "EGP";

  const totals = useMemo(() => {
    let volume = 0;
    let fees = 0;
    let expenses = 0;
    let txCount = 0;
    for (const s of dayShifts) {
      volume += s.summary?.totalVolume ?? 0;
      fees += s.summary?.totalFees ?? 0;
      expenses += s.summary?.totalExpenses ?? 0;
      txCount += s.summary?.transactionCount ?? 0;
    }
    return { volume, fees, expenses, txCount };
  }, [dayShifts]);

  const walletAgg = useMemo(() => {
    const m: Record<string, { expected: number; declared: number }> = {};
    for (const s of dayShifts) {
      for (const [k, v] of Object.entries(s.expectedBalances ?? {})) {
        if (!m[k]) m[k] = { expected: 0, declared: 0 };
        m[k]!.expected += v;
      }
      for (const [k, v] of Object.entries(s.declaredBalances ?? {})) {
        if (!m[k]) m[k] = { expected: 0, declared: 0 };
        m[k]!.declared += v;
      }
    }
    return m;
  }, [dayShifts]);

  const typeAgg = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of dayShifts) {
      const c = s.summary?.countsByType;
      if (!c) continue;
      for (const [k, v] of Object.entries(c)) {
        m[k] = (m[k] ?? 0) + (v ?? 0);
      }
    }
    return m;
  }, [dayShifts]);

  function walletLabel(id: string) {
    const w = wallets.find((x) => x.id === id);
    if (!w) return id;
    return locale === "ar" ? w.nameAr || w.nameEn : w.nameEn || w.nameAr;
  }

  async function submitCorrection() {
    if (!storeId || !user) return;
    const amt = Number(corrAmount);
    if (!corrShiftId || Number.isNaN(amt) || !corrReason.trim()) {
      toast.error(tc("required"));
      return;
    }
    const db = getDb();
    await addDoc(collection(db, "stores", storeId, "corrections"), {
      shiftId: corrShiftId,
      adminId: user.uid,
      amount: amt,
      reason: corrReason.trim(),
      createdAt: serverTimestamp(),
    });
    setCorrAmount("");
    setCorrReason("");
    toast.success(tc("save"));
  }

  function pdfForShift(s: ShiftDoc & { id: string }) {
    const fmt = (n: number) => formatMoney(n, currency, moneyLocale);
    const lines = buildShiftLedgerLines(s, walletLabel, fmt);
    downloadShiftLedgerPdf({
      title: `SahlCash shift ${s.id}`,
      locale,
      lines,
    });
  }

  return (
    <AdminGate>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("selectDate")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>{t("selectDate")}</Label>
              <Input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("totalVolume")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold">
              {loading
                ? "…"
                : formatMoney(totals.volume, currency, moneyLocale)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("totalFees")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold">
              {loading ? "…" : formatMoney(totals.fees, currency, moneyLocale)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("totalExpenses")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold">
              {loading
                ? "…"
                : formatMoney(totals.expenses, currency, moneyLocale)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("transactionCount")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold">
              {loading ? "…" : totals.txCount}
            </CardContent>
          </Card>
        </div>

        {Object.keys(typeAgg).length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("byTransactionType")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {Object.entries(typeAgg).map(([ty, n]) => (
                <Badge key={ty} variant="outline">
                  {ts(`types.${ty}`)}: {n}
                </Badge>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{t("byWallet")}</CardTitle>
            <CardDescription>{t("walletBalanceReconciliation")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("wallet")}</TableHead>
                  <TableHead>{t("expected")}</TableHead>
                  <TableHead>{t("declared")}</TableHead>
                  <TableHead>{tc("total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.keys(walletAgg).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4}>{tc("noData")}</TableCell>
                  </TableRow>
                ) : (
                  Object.entries(walletAgg).map(([id, v]) => {
                    const diff = v.declared - v.expected;
                    const variant =
                      Math.abs(diff) < 0.02
                        ? "success"
                        : diff < 0
                          ? "destructive"
                          : "warning";
                    return (
                      <TableRow key={id}>
                        <TableCell>{walletLabel(id)}</TableCell>
                        <TableCell>
                          {formatMoney(v.expected, currency, moneyLocale)}
                        </TableCell>
                        <TableCell>
                          {formatMoney(v.declared, currency, moneyLocale)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              variant as "success" | "destructive" | "warning"
                            }
                          >
                            {formatMoney(diff, currency, moneyLocale)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("ledgerTitle")}</CardTitle>
            <CardDescription>{t("ledgerSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {dayShifts.map((s) => (
              <Button
                key={s.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => pdfForShift(s)}
              >
                {tc("downloadPdf")} · {s.id.slice(0, 6)}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("correctionTitle")}</CardTitle>
            <CardDescription>{t("correctionHint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("selectShift")}</Label>
              <Select value={corrShiftId} onValueChange={setCorrShiftId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("selectShift")} />
                </SelectTrigger>
                <SelectContent>
                  {dayShifts.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.id.slice(0, 8)} · {s.cashierEmail ?? s.cashierId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{tc("amount")}</Label>
              <Input
                type="number"
                value={corrAmount}
                onChange={(e) => setCorrAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>{t("reason")}</Label>
              <Textarea
                value={corrReason}
                onChange={(e) => setCorrReason(e.target.value)}
              />
            </div>
            <Button type="button" onClick={() => void submitCorrection()}>
              {t("submitCorrection")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AdminGate>
  );
}
