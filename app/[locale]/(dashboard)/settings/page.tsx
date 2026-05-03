"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { toast } from "sonner";
import { AdminGate } from "@/components/admin-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";
import { getDb } from "@/lib/firebase/client";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { storeId, store } = useAuth();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("EGP");
  const [timezone, setTimezone] = useState("Africa/Cairo");
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    if (!store) return;
    setName(store.name ?? "");
    setCurrency(store.currency ?? "EGP");
    setTimezone(store.timezone ?? "Africa/Cairo");
    setLogoUrl(store.logoUrl ?? "");
  }, [store]);

  async function save() {
    if (!storeId) return;
    const db = getDb();
    await updateDoc(doc(db, "stores", storeId), {
      name: name.trim(),
      currency: currency.trim() || "EGP",
      timezone: timezone.trim() || "Africa/Cairo",
      logoUrl: logoUrl.trim() || "",
      updatedAt: serverTimestamp(),
    });
    toast.success(t("saveSuccess"));
  }

  return (
    <AdminGate>
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("logoHint")}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("adminOnly")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("storeName")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("currency")}</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("timezone")}</Label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("logoUrl")}</Label>
              <Textarea value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
            </div>
            <Button type="button" onClick={() => void save()}>
              {tc("save")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AdminGate>
  );
}
