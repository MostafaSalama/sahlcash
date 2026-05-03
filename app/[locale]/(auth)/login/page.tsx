"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { sendPasswordResetEmail } from "firebase/auth";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { firebaseAuthMessageKey } from "@/lib/firebase-auth-message-key";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const { signIn } = useAuth();
  const [pending, setPending] = useState(false);
  const [fpOpen, setFpOpen] = useState(false);
  const [fpEmail, setFpEmail] = useState("");
  const [fpPending, setFpPending] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: FormValues) {
    setPending(true);
    try {
      await signIn(values.email, values.password);
      toast.success(t("signInSuccess"));
      router.replace("/dashboard");
    } catch (e: unknown) {
      const key = firebaseAuthMessageKey(e);
      toast.error(key ? t(key) : tc("error"));
      console.error(e);
    } finally {
      setPending(false);
    }
  }

  async function sendReset() {
    const email = fpEmail.trim() || form.getValues("email").trim();
    if (!email) {
      toast.error(tc("required"));
      return;
    }
    setFpPending(true);
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), email);
      toast.success(t("resetSent"));
      setFpOpen(false);
      setFpEmail("");
    } catch (e: unknown) {
      const key = firebaseAuthMessageKey(e);
      toast.error(key ? t(key) : tc("error"));
      console.error(e);
    } finally {
      setFpPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md border bg-card shadow-lg">
      <CardHeader>
        <CardTitle>{t("signIn")}</CardTitle>
        <CardDescription>{t("appTagline")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
            {form.formState.errors.email ? (
              <p className="text-xs text-destructive">{tc("required")}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...form.register("password")}
            />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {t("signIn")}
          </Button>
        </form>
        <button
          type="button"
          className="mt-3 w-full text-center text-sm text-primary underline"
          onClick={() => {
            setFpEmail(form.getValues("email"));
            setFpOpen(true);
          }}
        >
          {t("forgotPassword")}
        </button>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t("noAccount")}{" "}
          <Link className="text-primary underline" href="/register">
            {t("signUp")}
          </Link>
        </p>

        <Dialog open={fpOpen} onOpenChange={setFpOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("forgotPassword")}</DialogTitle>
              <DialogDescription>{t("resetPasswordHint")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor="fpEmail">{t("email")}</Label>
              <Input
                id="fpEmail"
                type="email"
                value={fpEmail}
                onChange={(e) => setFpEmail(e.target.value)}
                placeholder={form.getValues("email")}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFpOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="button" disabled={fpPending} onClick={() => void sendReset()}>
                {tc("confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
