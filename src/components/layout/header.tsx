"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Bell,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  User,
  Waves,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
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
import { isNavActive, navItems } from "./nav-items";

const pageTitles: Record<string, string> = {
  "/dashboard": "dashboard",
  "/inbox": "inbox",
  "/notifications": "notifications",
  "/contacts": "contacts",
  "/pipelines": "pipelines",
  "/broadcasts": "broadcasts",
  "/automations": "automations",
  "/settings": "settings",
};

function getPageTitleKey(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path),
  );
  return match ? match[1] : "dashboard";
}

// Notifications get their own bell button on the right, so the centre
// pill group carries the remaining sections.
const centerNav = navItems.filter((item) => item.href !== "/notifications");

const CIRCLE_BTN =
  "relative flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-foreground/80 shadow-soft ring-1 ring-foreground/[0.06] transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

interface HeaderProps {
  /** Opens the mobile navigation drawer (hamburger is hidden on lg+). */
  onOpenSidebar?: () => void;
  totalUnread?: number;
  unreadNotifications?: number;
}

export function Header({
  onOpenSidebar,
  totalUnread = 0,
  unreadNotifications = 0,
}: HeaderProps) {
  const t = useTranslations("Header");
  const tNav = useTranslations("Sidebar");
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const titleKey = getPageTitleKey(pathname);
  const settingsActive = pathname.startsWith("/settings");
  const notificationsActive = pathname.startsWith("/notifications");

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="flex h-[4.5rem] shrink-0 items-center justify-between gap-3 px-4 sm:px-6 lg:h-20 lg:px-8">
      {/* Left: hamburger (mobile) + wordmark pill */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={t("openMenu")}
          className={cn(CIRCLE_BTN, "lg:hidden")}
        >
          <Menu className="size-5" />
        </button>
        <Link
          href="/dashboard"
          className="group flex items-center gap-2 rounded-full border border-foreground/20 px-4 py-2 transition-colors hover:border-foreground/40"
        >
          <Waves className="size-4 transition-transform duration-500 group-hover:-rotate-12" />
          <span className="text-lg leading-none font-normal tracking-tight text-foreground">
            {tNav("title")}
          </span>
        </Link>
        {/* Mobile: current section name next to the wordmark */}
        <span className="ml-1 hidden truncate text-sm text-muted-foreground sm:inline lg:hidden">
          {t(titleKey)}
        </span>
      </div>

      {/* Centre: pill navigation (desktop) */}
      <nav
        aria-label={tNav("primaryNav")}
        className="glass hidden items-center gap-0.5 rounded-full p-1 shadow-soft ring-1 ring-foreground/[0.06] lg:flex"
      >
        {centerNav.map((item) => {
          const active = isNavActive(pathname, item.href);
          const label = tNav(item.labelKey);
          const showUnreadDot =
            item.href === "/inbox" && totalUnread > 0 && !active;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-all xl:px-3.5 2xl:px-4",
                active
                  ? "bg-primary text-primary-foreground shadow-[0_6px_16px_-8px_rgb(0_0_0/0.5)]"
                  : "text-foreground/70 hover:bg-card hover:text-foreground",
              )}
            >
              <item.icon className="size-4 xl:hidden" />
              <span className="sr-only xl:not-sr-only">{label}</span>
              {item.beta ? (
                <span className="hidden size-1.5 rounded-full bg-highlight xl:inline-block" aria-hidden />
              ) : null}
              {showUnreadDot ? (
                <span
                  aria-label={tNav("unreadConversations", { count: totalUnread })}
                  className="absolute top-1.5 right-1.5 flex size-2"
                >
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-highlight opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-highlight ring-2 ring-card" />
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Right: settings pill, mode, notifications, account */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Link
          href="/settings"
          className={cn(
            "hidden h-10 items-center gap-2 rounded-full px-4 text-[13px] font-medium shadow-soft ring-1 ring-foreground/[0.06] transition-colors lg:flex",
            settingsActive
              ? "bg-primary text-primary-foreground"
              : "bg-card text-foreground/80 hover:text-foreground",
          )}
        >
          <SettingsIcon className="size-4" />
          <span className="hidden 2xl:inline">{tNav("settings")}</span>
        </Link>

        <ModeToggle className={CIRCLE_BTN} />

        <Link
          href="/notifications"
          aria-label={
            unreadNotifications > 0
              ? tNav("unreadNotifications", { count: unreadNotifications })
              : tNav("notifications")
          }
          className={cn(
            CIRCLE_BTN,
            notificationsActive && "bg-primary text-primary-foreground hover:text-primary-foreground",
          )}
        >
          <Bell className="size-[18px]" />
          {unreadNotifications > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-highlight px-1 text-[9px] font-semibold text-highlight-foreground ring-2 ring-card">
              {unreadNotifications > 9 ? "9+" : unreadNotifications}
            </span>
          ) : null}
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(CIRCLE_BTN, "overflow-hidden p-0 data-popup-open:ring-2 data-popup-open:ring-ring")}
            aria-label={t("openAccountMenu")}
          >
            <Avatar className="size-10">
              {profile?.avatar_url ? (
                <AvatarImage
                  src={profile.avatar_url}
                  alt={profile.full_name ?? t("defaultAvatar")}
                />
              ) : null}
              <AvatarFallback className="bg-highlight text-sm font-medium text-highlight-foreground">
                {initial}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="min-w-60 bg-popover text-popover-foreground"
          >
            <div className="flex items-center gap-3 px-2.5 py-2">
              <Avatar className="size-9">
                {profile?.avatar_url ? (
                  <AvatarImage src={profile.avatar_url} alt="" />
                ) : null}
                <AvatarFallback className="bg-highlight text-sm font-medium text-highlight-foreground">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {profile?.full_name ?? t("defaultUser")}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.email ?? ""}
                </p>
              </div>
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
              {t("menuProfile")}
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
              {t("menuSettings")}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={signOut}
              className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
            >
              <LogOut className="size-4" />
              {t("menuSignOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
