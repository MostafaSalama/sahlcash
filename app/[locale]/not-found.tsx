import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("errors");
  const tNav = await getTranslations("nav");
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8">
      <p className="text-lg font-medium">{t("notFound")}</p>
      <Link className="text-primary underline" href="/dashboard">
        {tNav("dashboard")}
      </Link>
    </div>
  );
}
