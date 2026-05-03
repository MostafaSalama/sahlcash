"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/auth-context";

const ownerSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(6),
    confirmPassword: z.string().min(6),
    storeName: z.string().min(2),
    displayName: z.string().min(2),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "passwordMismatch",
    path: ["confirmPassword"],
  });

const cashierSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(6),
    confirmPassword: z.string().min(6),
    inviteCode: z.string().min(4),
    displayName: z.string().min(2),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "passwordMismatch",
    path: ["confirmPassword"],
  });

type OwnerForm = z.infer<typeof ownerSchema>;
type CashierForm = z.infer<typeof cashierSchema>;

export default function RegisterPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const { registerOwner, registerCashier } = useAuth();
  const [tab, setTab] = useState<"owner" | "cashier">("owner");
  const [pending, setPending] = useState(false);

  const ownerForm = useForm<OwnerForm>({
    resolver: zodResolver(ownerSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
      storeName: "",
      displayName: "",
    },
  });

  const cashierForm = useForm<CashierForm>({
    resolver: zodResolver(cashierSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
      inviteCode: "",
      displayName: "",
    },
  });

  async function onOwner(values: OwnerForm) {
    setPending(true);
    try {
      await registerOwner({
        email: values.email,
        password: values.password,
        storeName: values.storeName,
        displayName: values.displayName,
      });
      toast.success("OK");
      router.replace("/dashboard");
    } catch (e) {
      console.error(e);
      toast.error(tc("error"));
    } finally {
      setPending(false);
    }
  }

  async function onCashier(values: CashierForm) {
    setPending(true);
    try {
      await registerCashier({
        email: values.email,
        password: values.password,
        inviteCode: values.inviteCode,
        displayName: values.displayName,
      });
      toast.success("OK");
      router.replace("/dashboard");
    } catch (e: unknown) {
      console.error(e);
      const msg =
        e instanceof Error && e.message === "INVALID_INVITE"
          ? t("invalidInvite")
          : tc("error");
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md border bg-card shadow-lg">
      <CardHeader>
        <CardTitle>{t("signUp")}</CardTitle>
        <CardDescription>SahlCash</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as "owner" | "cashier")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="owner">{t("roleOwner")}</TabsTrigger>
            <TabsTrigger value="cashier">{t("roleCashier")}</TabsTrigger>
          </TabsList>
          <TabsContent value="owner" className="mt-4 space-y-4">
            <form className="space-y-4" onSubmit={ownerForm.handleSubmit(onOwner)}>
              <div className="space-y-2">
                <Label>{t("storeName")}</Label>
                <Input {...ownerForm.register("storeName")} />
              </div>
              <div className="space-y-2">
                <Label>{t("email")}</Label>
                <Input type="email" autoComplete="email" {...ownerForm.register("email")} />
              </div>
              <div className="space-y-2">
                <Label>{t("password")}</Label>
                <Input type="password" {...ownerForm.register("password")} />
              </div>
              <div className="space-y-2">
                <Label>{t("confirmPassword")}</Label>
                <Input type="password" {...ownerForm.register("confirmPassword")} />
                {ownerForm.formState.errors.confirmPassword ? (
                  <p className="text-xs text-destructive">{t("passwordMismatch")}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>{tc("optional")} — display name</Label>
                <Input {...ownerForm.register("displayName")} />
              </div>
              <Button type="submit" className="w-full" disabled={pending}>
                {t("signUp")}
              </Button>
            </form>
          </TabsContent>
          <TabsContent value="cashier" className="mt-4 space-y-4">
            <form className="space-y-4" onSubmit={cashierForm.handleSubmit(onCashier)}>
              <div className="space-y-2">
                <Label>{t("inviteCode")}</Label>
                <Input {...cashierForm.register("inviteCode")} />
                <p className="text-xs text-muted-foreground">{t("inviteHint")}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("email")}</Label>
                <Input type="email" autoComplete="email" {...cashierForm.register("email")} />
              </div>
              <div className="space-y-2">
                <Label>{t("password")}</Label>
                <Input type="password" {...cashierForm.register("password")} />
              </div>
              <div className="space-y-2">
                <Label>{t("confirmPassword")}</Label>
                <Input type="password" {...cashierForm.register("confirmPassword")} />
                {cashierForm.formState.errors.confirmPassword ? (
                  <p className="text-xs text-destructive">{t("passwordMismatch")}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Display name</Label>
                <Input {...cashierForm.register("displayName")} />
              </div>
              <Button type="submit" className="w-full" disabled={pending}>
                {t("signUp")}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t("alreadyHaveAccount")}{" "}
          <Link className="text-primary underline" href="/login">
            {t("signIn")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
