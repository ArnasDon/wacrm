"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { useAuth } from "@/hooks/use-auth";
import {
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
  User,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { LanguageSwitcher } from "@/components/layout/language-switcher";

const pageTitleKeys: Record<string, string> = {
  "/dashboard": "nav.dashboard",
  "/inbox": "nav.inbox",
  "/notifications": "nav.notifications",
  "/contacts": "nav.contacts",
  "/pipelines": "nav.pipelines",
  "/broadcasts": "nav.broadcasts",
  "/automations": "nav.automations",
  "/settings": "nav.settings",
};

function getPageTitleKey(pathname: string): string {
  if (pageTitleKeys[pathname]) return pageTitleKeys[pathname];
  const match = Object.entries(pageTitleKeys).find(([path]) =>
    pathname.startsWith(path),
  );
  return match ? match[1] : "nav.dashboard";
}

interface HeaderProps {
  onOpenSidebar?: () => void;
  /** Desktop only — the sidebar is currently an icon rail. */
  sidebarCollapsed?: boolean;
  /** Desktop only — collapse/expand the sidebar. */
  onToggleSidebar?: () => void;
}

export function Header({
  onOpenSidebar,
  sidebarCollapsed = false,
  onToggleSidebar,
}: HeaderProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const titleKey = getPageTitleKey(pathname);

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={t("common.open")}
          className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        {/* Desktop counterpart of the mobile drawer button: collapses
            the sidebar to an icon rail so wide pages (the pipeline
            kanban above all) get the width back. Same slot as the
            hamburger so the control never moves between breakpoints. */}
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={t(
            sidebarCollapsed ? "sidebar.expand" : "sidebar.collapse",
          )}
          title={`${t(
            sidebarCollapsed ? "sidebar.expand" : "sidebar.collapse",
          )} (Ctrl+B)`}
          aria-expanded={!sidebarCollapsed}
          className="hidden h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-5 w-5" />
          ) : (
            <PanelLeftClose className="h-5 w-5" />
          )}
        </button>
        <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
          {t(titleKey as string)}
        </h1>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <LanguageSwitcher />
        <ModeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-muted/70 focus:bg-muted/70 focus:outline-none data-popup-open:bg-muted/70 sm:gap-3 sm:pl-1 sm:pr-3"
            aria-label={t("header.openAccountMenu")}
          >
            <Avatar className="size-8">
              {profile?.avatar_url ? (
                <AvatarImage
                  src={profile.avatar_url}
                  alt={profile.full_name ?? "Avatar"}
                />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                {initial}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium text-foreground sm:inline">
              {profile?.full_name ?? t("common.user")}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="min-w-56 bg-popover text-popover-foreground ring-border"
          >
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium text-foreground">
                <span>{profile?.full_name ?? t("common.user")}</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {profile?.email ?? ""}
              </p>
            </div>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=profile"
                  className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                />
              }
            >
              <User className="size-4" />
              {t("header.profile")}
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=whatsapp"
                  className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                />
              }
            >
              <SettingsIcon className="size-4" />
              {t("header.settings")}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={signOut}
              className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
            >
              <LogOut className="size-4" />
              {t("header.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
