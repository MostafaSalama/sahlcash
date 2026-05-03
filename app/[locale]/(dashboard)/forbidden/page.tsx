"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export default function ForbiddenPage() {
  const t = useTranslations("errors");
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">403</h1>
      <p className="text-muted-foreground">{t("forbidden")}</p>
      <Button asChild>
        <Link href="/dashboard">{t("backToDashboard")}</Link>
      </Button>
    </div>
  );
}
