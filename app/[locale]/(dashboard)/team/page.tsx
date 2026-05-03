"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { toast } from "sonner";
import { AdminGate } from "@/components/admin-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";
import { getDb } from "@/lib/firebase/client";
import { randomInviteCode } from "@/lib/utils";
import type { StoreUserDoc } from "@/types/firestore";

export default function TeamPage() {
  const t = useTranslations("team");
  const tc = useTranslations("common");
  const { storeId, store } = useAuth();
  const [members, setMembers] = useState<(StoreUserDoc & { id: string })[]>([]);

  useEffect(() => {
    if (!storeId) return;
    const db = getDb();
    const unsub = onSnapshot(
      collection(db, "stores", storeId, "users"),
      (snap) =>
        setMembers(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as StoreUserDoc),
          }))
        )
    );
    return () => unsub();
  }, [storeId]);

  async function regenerate() {
    if (!storeId || !store?.inviteCode) return;
    const db = getDb();
    const oldCode = store.inviteCode;
    const newCode = randomInviteCode(8);
    const batch = writeBatch(db);
    batch.update(doc(db, "stores", storeId), {
      inviteCode: newCode,
      updatedAt: serverTimestamp(),
    });
    batch.delete(doc(db, "publicStoreInvites", oldCode));
    batch.set(doc(db, "publicStoreInvites", newCode), { storeId });
    await batch.commit();
    toast.success(tc("save"));
  }

  async function copyCode() {
    if (!store?.inviteCode) return;
    await navigator.clipboard.writeText(store.inviteCode);
    toast.success(tc("save"));
  }

  async function toggleMember(m: StoreUserDoc & { id: string }) {
    if (!storeId) return;
    const db = getDb();
    await updateDoc(doc(db, "stores", storeId, "users", m.id), {
      active: !m.active,
    });
  }

  return (
    <AdminGate>
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("inviteCodeLabel")}</CardTitle>
            <CardDescription>{t("subtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <code className="rounded-md bg-muted px-3 py-2 text-lg tracking-widest">
              {store?.inviteCode ?? "—"}
            </code>
            <Button type="button" variant="outline" onClick={() => void copyCode()}>
              {t("copy")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void regenerate()}>
              {t("regenerate")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("members")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("email")}</TableHead>
                  <TableHead>{t("role")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead>{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.email}</TableCell>
                    <TableCell>
                      {m.role === "admin" ? tc("admin") : tc("cashier")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.active ? "success" : "secondary"}>
                        {m.active ? t("active") : t("inactive")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => void toggleMember(m)}
                      >
                        {t("toggleStatus")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AdminGate>
  );
}
