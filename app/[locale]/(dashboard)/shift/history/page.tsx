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
import { Link } from "@/i18n/navigation";
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
import { useAuth } from "@/contexts/auth-context";
import { getDb } from "@/lib/firebase/client";
import { formatMoney } from "@/lib/utils";
import type { ShiftDoc } from "@/types/firestore";

function fmtDate(ts: Timestamp | undefined, locale: string) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString(locale === "ar" ? "ar-EG" : "en-US");
}

export default function ShiftHistoryPage() {
  const t = useTranslations("shift");
  const td = useTranslations("shift.detail");
  const tc = useTranslations("common");
  const locale = useLocale();
  const moneyLocale = locale === "ar" ? "ar-EG" : "en-US";
  const { storeId, store } = useAuth();
  const [rows, setRows] = useState<(ShiftDoc & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

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
          limit(100)
        );
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as ShiftDoc),
        }));
        if (!cancelled) setRows(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.cashierEmail?.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
    );
  }, [rows, filter]);

  const currency = store?.currency ?? "EGP";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("historyTitle")}</h1>
          <p className="text-muted-foreground">{tc("search")}</p>
        </div>
        <Input
          className="max-w-xs"
          placeholder={tc("search")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
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
                <TableHead className="w-[1%]">{td("viewDetails")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8}>{tc("loading")}</TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>{tc("noData")}</TableCell>
                </TableRow>
              ) : (
                filtered.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Badge
                        variant={
                          s.status === "open" ? "warning" : "secondary"
                        }
                      >
                        {s.status === "open" ? tc("open") : tc("closed")}
                      </Badge>
                    </TableCell>
                    <TableCell>{s.cashierEmail ?? s.cashierId}</TableCell>
                    <TableCell>{fmtDate(s.startedAt as Timestamp, locale)}</TableCell>
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
        </CardContent>
      </Card>
    </div>
  );
}
