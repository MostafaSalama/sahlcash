"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { MobileNavToggle } from "@/components/layout/sidebar";
import { useAuth } from "@/contexts/auth-context";
import { useConnectivity } from "@/contexts/connectivity-context";
import { Badge } from "@/components/ui/badge";

export function TopBar({
  title,
  onMenuClick,
}: {
  title?: string;
  onMenuClick: () => void;
}) {
  const { setTheme, theme } = useTheme();
  const { signOut, profile } = useAuth();
  const { online, pendingSync } = useConnectivity();
  const t = useTranslations("nav");
  const tc = useTranslations("common");

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <MobileNavToggle onClick={onMenuClick} />
      <div className="flex flex-1 flex-col">
        {title ? (
          <h1 className="text-base font-semibold leading-tight md:text-lg">
            {title}
          </h1>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {!online ? (
          <Badge variant="destructive">{tc("offline")}</Badge>
        ) : pendingSync > 0 ? (
          <Badge variant="warning">{tc("pendingSync", { count: pendingSync })}</Badge>
        ) : (
          <Badge variant="success" className="hidden sm:inline-flex">
            {tc("online")}
          </Badge>
        )}
        <LocaleSwitcher />
        <Button
          variant="outline"
          size="icon"
          type="button"
          className="relative"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="max-w-[140px] truncate">
              {profile?.displayName ?? "…"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => signOut()}>
              <LogOut className="h-4 w-4" />
              {t("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
