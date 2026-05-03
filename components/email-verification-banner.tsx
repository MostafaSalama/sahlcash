"use client";

import { useState } from "react";
import { sendEmailVerification } from "firebase/auth";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";

export function EmailVerificationBanner() {
  const { user } = useAuth();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [pending, setPending] = useState(false);

  if (!user?.email || user.emailVerified) {
    return null;
  }

  async function resend() {
    const auth = getFirebaseAuth();
    const u = auth.currentUser;
    if (!u) return;
    setPending(true);
    try {
      await sendEmailVerification(u);
      toast.success(t("verificationEmailSent"));
    } catch (e) {
      console.error(e);
      toast.error(tc("error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">{t("verifyEmailTitle")}</p>
          <p className="text-muted-foreground">{t("verifyEmailHint")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void resend()}
        >
          {t("resendVerification")}
        </Button>
      </div>
    </div>
  );
}
