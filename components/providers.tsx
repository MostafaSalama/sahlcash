"use client";

import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { Toaster } from "sonner";
import type { AbstractIntlMessages } from "next-intl";
import type { ReactNode } from "react";
import { AuthProvider } from "@/contexts/auth-context";
import { ConnectivityProvider } from "@/contexts/connectivity-context";
import { ServiceWorkerRegister } from "@/components/service-worker-register";

export function Providers({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: AbstractIntlMessages;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <AuthProvider>
          <ConnectivityProvider>
            <ServiceWorkerRegister />
            {children}
            <Toaster richColors position="top-center" />
          </ConnectivityProvider>
        </AuthProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
