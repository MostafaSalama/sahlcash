import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (
    !locale ||
    !routing.locales.includes(locale as "en" | "ar")
  ) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Avoid next-intl ENVIRONMENT_FALLBACK / hydration mismatches (see next-intl time zone docs).
    timeZone: process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE ?? "UTC",
  };
});
