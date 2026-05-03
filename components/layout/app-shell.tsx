"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { EmailVerificationBanner } from "@/components/email-verification-banner";
import type { UserRole } from "@/types/firestore";

export function AppShell({
  role,
  title,
  children,
}: {
  role: UserRole;
  title?: string;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <EmailVerificationBanner />
      <div className="flex min-h-screen bg-background">
        <div className="no-print shrink-0">
          <Sidebar
            role={role}
            mobileOpen={mobileOpen}
            onMobileOpenChange={setMobileOpen}
          />
        </div>
        <div className="flex min-h-screen flex-1 flex-col">
          <div className="no-print">
            <TopBar title={title} onMenuClick={() => setMobileOpen(true)} />
          </div>
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </>
  );
}
