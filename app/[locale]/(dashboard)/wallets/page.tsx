"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  collection,
  deleteField,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";
import { getDb } from "@/lib/firebase/client";
import { computeFee } from "@/lib/commission";
import { commitWalletRecharge } from "@/lib/firebase/balance-batch";
import { computeRechargeEffects } from "@/lib/transaction-effects";
import { formatMoney } from "@/lib/utils";
import type { RechargeSource, WalletDoc, WalletType } from "@/types/firestore";

function emptyForm(): Omit<WalletDoc, "createdAt" | "updatedAt"> & {
  id?: string;
} {
  return {
    nameEn: "",
    nameAr: "",
    type: "other",
    defaultFeePercent: 0,
    defaultFeeFixed: 0,
    color: "#64748b",
    icon: "credit-card",
    isActive: true,
    sortOrder: 99,
    lowBalanceAlert: undefined,
  };
}

export default function WalletsPage() {
  const t = useTranslations("wallets");
  const tc = useTranslations("common");
  const locale = useLocale();
  const moneyLocale = locale === "ar" ? "ar-EG" : "en-US";
  const { storeId, store } = useAuth();
  const [items, setItems] = useState<(WalletDoc & { id: string })[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [rechargeWalletId, setRechargeWalletId] = useState("");
  const [rechargeAmountStr, setRechargeAmountStr] = useState("");
  const [rechargeSource, setRechargeSource] =
    useState<RechargeSource>("cash");

  const currency = store?.currency ?? "EGP";
  const cashWalletId = items.find((w) => w.type === "cash")?.id ?? null;

  useEffect(() => {
    if (!storeId) return;
    const db = getDb();
    const unsub = onSnapshot(
      collection(db, "stores", storeId, "wallets"),
      (snap) => {
        setItems(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as WalletDoc),
          }))
        );
      }
    );
    const unsubBal = onSnapshot(
      collection(db, "stores", storeId, "walletBalances"),
      (snap) => {
        const m: Record<string, number> = {};
        snap.docs.forEach((d) => {
          m[d.id] = (d.data().currentBalance as number) ?? 0;
        });
        setBalances(m);
      }
    );
    return () => {
      unsub();
      unsubBal();
    };
  }, [storeId]);

  function label(m: WalletDoc & { id: string }) {
    return locale === "ar" ? m.nameAr || m.nameEn : m.nameEn || m.nameAr;
  }

  async function saveWallet() {
    if (!storeId) return;
    const db = getDb();
    const base = {
      nameEn: form.nameEn.trim(),
      nameAr: form.nameAr.trim(),
      type: form.type,
      defaultFeePercent: Number(form.defaultFeePercent) || 0,
      defaultFeeFixed: Number(form.defaultFeeFixed) || 0,
      color: form.color,
      icon: form.icon,
      isActive: form.isActive,
      sortOrder: Number(form.sortOrder) || 0,
      updatedAt: serverTimestamp(),
    };
    const isEdit = Boolean(form.id);
    let lowBalanceAlert: number | ReturnType<typeof deleteField> | undefined;
    if (form.type === "cash") {
      lowBalanceAlert = isEdit ? deleteField() : undefined;
    } else {
      const raw = form.lowBalanceAlert;
      const str =
        raw === undefined || raw === null ? "" : String(raw).trim();
      if (str === "") {
        lowBalanceAlert = isEdit ? deleteField() : undefined;
      } else {
        const n = Number(str);
        lowBalanceAlert =
          !Number.isNaN(n) && n >= 0 ? n : isEdit ? deleteField() : undefined;
      }
    }
    const payload: Record<string, unknown> = { ...base };
    if (lowBalanceAlert !== undefined) {
      payload.lowBalanceAlert = lowBalanceAlert;
    }
    if (!base.nameEn || !base.nameAr) {
      toast.error(tc("required"));
      return;
    }
    if (form.id) {
      await updateDoc(doc(db, "stores", storeId, "wallets", form.id), {
        ...payload,
      });
    } else {
      const batch = writeBatch(db);
      const ref = doc(collection(db, "stores", storeId, "wallets"));
      batch.set(ref, {
        ...payload,
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, "stores", storeId, "walletBalances", ref.id), {
        currentBalance: 0,
        lastUpdatedAt: serverTimestamp(),
      });
      await batch.commit();
    }
    setOpen(false);
    setForm(emptyForm());
    toast.success(tc("save"));
  }

  async function toggleArchive(m: WalletDoc & { id: string }) {
    if (!storeId) return;
    const db = getDb();
    await updateDoc(doc(db, "stores", storeId, "wallets", m.id), {
      isActive: !m.isActive,
      updatedAt: serverTimestamp(),
    });
  }

  async function submitQuickRecharge() {
    if (!storeId || !cashWalletId || !rechargeWalletId) return;
    const amt = Number(rechargeAmountStr);
    if (Number.isNaN(amt) || amt <= 0) {
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
      amount: amt,
      source: rechargeSource,
      cashWalletId: rechargeSource === "cash" ? cashWalletId : undefined,
      clientId: crypto.randomUUID(),
    };

    const db = getDb();
    await commitWalletRecharge(db, storeId, payload, deltas);
    setRechargeOpen(false);
    setRechargeAmountStr("");
    toast.success(tc("save"));
  }

  const previewFee = computeFee(
    100,
    "percent",
    Number(form.defaultFeePercent) || 0,
    Number(form.defaultFeeFixed) || 0
  );

  return (
    <AdminGate>
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground">{t("subtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const first = items.find((w) => w.type !== "cash");
                setRechargeWalletId(first?.id ?? "");
                setRechargeOpen(true);
              }}
            >
              {t("quickRecharge")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setForm(emptyForm());
                setOpen(true);
              }}
            >
              {tc("add")}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">{t("active")}</TabsTrigger>
            <TabsTrigger value="archived">{t("archived")}</TabsTrigger>
          </TabsList>
          <TabsContent value="active">
            <Card>
              <CardHeader>
                <CardTitle>{t("title")}</CardTitle>
                <CardDescription>{t("subtitle")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tc("actions")}</TableHead>
                      <TableHead>{t("balance")}</TableHead>
                      <TableHead>{t("nameEn")}</TableHead>
                      <TableHead>{t("type")}</TableHead>
                      <TableHead>{t("defaultFeePercent")}</TableHead>
                      <TableHead>{t("defaultFeeFixed")}</TableHead>
                      <TableHead>{t("lowBalanceAlert")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.filter((x) => x.isActive).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7}>{tc("noData")}</TableCell>
                      </TableRow>
                    ) : (
                      items
                        .filter((x) => x.isActive)
                        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                        .map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                type="button"
                                onClick={() => {
                                  setForm({ ...m });
                                  setOpen(true);
                                }}
                              >
                                {tc("edit")}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                type="button"
                                onClick={() => void toggleArchive(m)}
                              >
                                {t("archive")}
                              </Button>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {formatMoney(
                                  balances[m.id] ?? 0,
                                  currency,
                                  moneyLocale
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell>{label(m)}</TableCell>
                            <TableCell>{m.type}</TableCell>
                            <TableCell>{m.defaultFeePercent}%</TableCell>
                            <TableCell>
                              {formatMoney(
                                m.defaultFeeFixed,
                                currency,
                                moneyLocale
                              )}
                            </TableCell>
                            <TableCell>
                              {m.lowBalanceAlert != null
                                ? formatMoney(
                                    m.lowBalanceAlert,
                                    currency,
                                    moneyLocale
                                  )
                                : "—"}
                            </TableCell>
                          </TableRow>
                        ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="archived">
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tc("actions")}</TableHead>
                      <TableHead>Name</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.filter((x) => !x.isActive).map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <Button
                            size="sm"
                            type="button"
                            onClick={() => void toggleArchive(m)}
                          >
                            {t("restore")}
                          </Button>
                        </TableCell>
                        <TableCell>{label(m)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{form.id ? tc("edit") : tc("add")}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("nameEn")}</Label>
                  <Input
                    value={form.nameEn}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, nameEn: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("nameAr")}</Label>
                  <Input
                    value={form.nameAr}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, nameAr: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("type")}</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, type: v as WalletType }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t("typeCash")}</SelectItem>
                    <SelectItem value="pos">{t("typePos")}</SelectItem>
                    <SelectItem value="ewallet">{t("typeEwallet")}</SelectItem>
                    <SelectItem value="bank">{t("typeBank")}</SelectItem>
                    <SelectItem value="other">{t("typeOther")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("defaultFeePercent")}</Label>
                  <Input
                    type="number"
                    value={form.defaultFeePercent}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        defaultFeePercent: Number(e.target.value),
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("defaultFeeFixed")}</Label>
                  <Input
                    type="number"
                    value={form.defaultFeeFixed}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        defaultFeeFixed: Number(e.target.value),
                      }))
                    }
                  />
                </div>
              </div>
              {form.type !== "cash" ? (
                <div className="space-y-2">
                  <Label>{t("lowBalanceAlert")}</Label>
                  <Input
                    type="number"
                    value={form.lowBalanceAlert ?? ""}
                    placeholder={t("lowBalanceHint")}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        lowBalanceAlert:
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                      }))
                    }
                  />
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Color</Label>
                  <Input
                    type="text"
                    value={form.color}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, color: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Sort</Label>
                  <Input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        sortOrder: Number(e.target.value),
                      }))
                    }
                  />
                </div>
              </div>
              <Badge variant="outline">
                {t("previewFeeOn100", {
                  fee: formatMoney(previewFee, currency, moneyLocale),
                })}
              </Badge>
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="button" onClick={() => void saveWallet()}>
                {tc("save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={rechargeOpen} onOpenChange={setRechargeOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("quickRecharge")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>{t("wallet")}</Label>
                <Select value={rechargeWalletId} onValueChange={setRechargeWalletId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {items
                      .filter((w) => w.isActive && w.type !== "cash")
                      .map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {label(w)}
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
              <Button type="button" onClick={() => void submitQuickRecharge()}>
                {tc("save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminGate>
  );
}
