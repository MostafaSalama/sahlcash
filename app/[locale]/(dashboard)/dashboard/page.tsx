"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { Timestamp } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";
import { getDb } from "@/lib/firebase/client";
import { formatMoney } from "@/lib/utils";
import type { ShiftDoc } from "@/types/firestore";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { storeId, store, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [shifts, setShifts] = useState<(ShiftDoc & { id: string })[]>([]);
  const [openCount, setOpenCount] = useState(0);

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
          limit(80)
        );
        const snap = await getDocs(q);
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as ShiftDoc),
        }));
        if (!cancelled) setShifts(rows);

        const openQ = query(
          collection(db, "stores", storeId, "shifts"),
          where("status", "==", "open"),
          limit(50)
        );
        const openSnap = await getDocs(openQ);
        if (!cancelled) setOpenCount(openSnap.size);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const today = startOfToday();

  const metrics = useMemo(() => {
    let volume = 0;
    let fees = 0;
    let disc = 0;
    for (const s of shifts) {
      if (s.status !== "closed" || !s.closedAt) continue;
      const closed =
        s.closedAt instanceof Timestamp
          ? s.closedAt.toDate()
          : new Date();
      if (closed < today) continue;
      volume += s.summary?.totalVolume ?? 0;
      fees += s.summary?.totalFees ?? 0;
      if (s.discrepancies) {
        for (const v of Object.values(s.discrepancies)) {
          if (Math.abs(v) > 0.01) disc += 1;
        }
      }
    }
    return { volume, fees, disc };
  }, [shifts, today]);

  const moneyLocale = locale === "ar" ? "ar-EG" : "en-US";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("welcome", { name: profile?.displayName ?? "" })}
        </h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("todayVolume")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {loading ? "…" : formatMoney(metrics.volume, store?.currency ?? "EGP", moneyLocale)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("todayProfit")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {loading
                ? "…"
                : formatMoney(metrics.fees, store?.currency ?? "EGP", moneyLocale)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("activeShifts")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <p className="text-2xl font-semibold">{loading ? "…" : openCount}</p>
            {!loading && openCount > 0 ? (
              <Badge variant="warning">{tc("open")}</Badge>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("openDiscrepancies")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{loading ? "…" : metrics.disc}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/shift">{t("quickShift")}</Link>
        </Button>
        {profile?.role === "admin" ? (
          <Button variant="outline" asChild>
            <Link href="/wallets">{t("manageWallets")}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
