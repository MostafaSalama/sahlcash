"use client";

import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Wallet,
  History,
  CreditCard,
  Scale,
  BarChart3,
  Users,
  Settings,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import type { UserRole } from "@/types/firestore";

const nav: {
  href: string;
  key: "dashboard" | "shift" | "shiftHistory" | "wallets" | "reconciliation" | "analytics" | "team" | "settings";
  icon: LucideIcon;
  roles: UserRole[];
}[] = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard, roles: ["admin", "cashier"] },
  { href: "/shift", key: "shift", icon: Wallet, roles: ["admin", "cashier"] },
  { href: "/shift/history", key: "shiftHistory", icon: History, roles: ["admin", "cashier"] },
  { href: "/wallets", key: "wallets", icon: CreditCard, roles: ["admin"] },
  { href: "/reconciliation", key: "reconciliation", icon: Scale, roles: ["admin"] },
  { href: "/analytics", key: "analytics", icon: BarChart3, roles: ["admin"] },
  { href: "/team", key: "team", icon: Users, roles: ["admin"] },
  { href: "/settings", key: "settings", icon: Settings, roles: ["admin"] },
];

export function Sidebar({
  role,
  mobileOpen,
  onMobileOpenChange,
}: {
  role: UserRole;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  const items = nav.filter((item) => item.roles.includes(role));

  const inner = (
    <nav className="flex flex-col gap-1 p-3">
      <div className="mb-4 px-2">
        <span className="text-lg font-bold tracking-tight text-primary">
          SahlCash
        </span>
        <p className="text-xs text-muted-foreground">سهل كاش</p>
      </div>
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => onMobileOpenChange(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <aside className="hidden h-screen w-56 shrink-0 border-e bg-card md:flex md:flex-col">
        {inner}
      </aside>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 md:hidden",
          mobileOpen ? "block" : "hidden"
        )}
        aria-hidden={!mobileOpen}
        onClick={() => onMobileOpenChange(false)}
      />
      <aside
        className={cn(
          "fixed start-0 top-0 z-50 h-full w-56 border-e bg-card shadow-lg transition-transform md:hidden",
          mobileOpen
            ? "translate-x-0 rtl:translate-x-0"
            : "-translate-x-full rtl:translate-x-full"
        )}
      >
        {inner}
      </aside>
    </>
  );
}

export function MobileNavToggle({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="md:hidden"
      onClick={onClick}
      aria-label="Menu"
    >
      <Menu className="h-5 w-5" />
    </Button>
  );
}
