"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  Crown,
  LogOut,
  Settings,
  Shield,
  User,
  UserCog,
  UsersRound,
  Waves,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import type { AccountRole } from "@/lib/auth/roles";
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
import { bottomNavItems, isNavActive, navItems } from "./nav-items";

// Per-role chip metadata used in the drawer's account strip.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: "roleOwner",
    // Yellow highlight: scarce, immutable, "the boss".
    className: "border-transparent bg-highlight text-highlight-foreground",
  },
  admin: {
    icon: Shield,
    labelKey: "roleAdmin",
    className: "border-transparent bg-primary text-primary-foreground",
  },
  agent: {
    icon: UserCog,
    labelKey: "roleAgent",
    className: "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    labelKey: "roleViewer",
    className: "border-border bg-card text-muted-foreground",
  },
};

interface SidebarProps {
  /** Controlled by the Header's hamburger button. */
  open?: boolean;
  onClose?: () => void;
  /** Conversations with unread inbound messages (computed once in the shell). */
  totalUnread?: number;
  /** Unread notifications (computed once in the shell). */
  unreadNotifications?: number;
}

/**
 * Mobile / tablet navigation drawer. On lg+ the top bar in header.tsx
 * carries navigation instead, so this component is hidden there.
 */
export function Sidebar({
  open = false,
  onClose,
  totalUnread = 0,
  unreadNotifications = 0,
}: SidebarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  // Only surface the account-name strip when it carries information
  // (renamed or shared account). See git history for the full rationale.
  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  // Close the drawer when the route changes.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const allItems = [...navItems, ...bottomNavItems];

  return (
    <>
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-foreground/20 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "app-canvas fixed inset-y-2 left-2 z-40 flex w-72 flex-col overflow-hidden rounded-[1.75rem] shadow-float ring-1 ring-foreground/[0.06]",
          "transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] will-change-transform",
          open ? "translate-x-0" : "-translate-x-[calc(100%+1rem)]",
          "lg:hidden",
        )}
        aria-label={t("primaryNav")}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-full border border-foreground/15 px-3.5 py-1.5"
          >
            <Waves className="size-4" />
            <span className="text-base font-normal tracking-tight text-foreground">
              {t("title")}
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex size-10 items-center justify-center rounded-full bg-card text-muted-foreground shadow-soft hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2">
          <ul className="flex flex-col gap-1">
            {allItems.map((item) => {
              const isActive = isNavActive(pathname, item.href);
              const showUnreadDot =
                item.href === "/inbox" && totalUnread > 0 && !isActive;
              const showNotificationBadge =
                item.href === "/notifications" && unreadNotifications > 0;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-full px-4 py-3 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-soft"
                        : "text-foreground/70 hover:bg-card hover:text-foreground",
                    )}
                  >
                    <item.icon className="size-4" />
                    <span className="flex-1">{t(item.labelKey)}</span>
                    {item.beta && (
                      <span
                        aria-label={t("beta")}
                        className="rounded-full bg-highlight px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-highlight-foreground"
                      >
                        {t("beta")}
                      </span>
                    )}
                    {showUnreadDot && (
                      <span
                        aria-label={t("unreadConversations", { count: totalUnread })}
                        className="relative flex size-2"
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-highlight opacity-75" />
                        <span className="relative inline-flex size-2 rounded-full bg-highlight ring-2 ring-foreground/20" />
                      </span>
                    )}
                    {showNotificationBadge && (
                      <span
                        aria-label={t("unreadNotifications", { count: unreadNotifications })}
                        className="flex h-5 min-w-5 items-center justify-center rounded-full bg-highlight px-1 text-[10px] font-semibold text-highlight-foreground"
                      >
                        {unreadNotifications > 9 ? "9+" : unreadNotifications}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="m-3 shrink-0 rounded-3xl bg-ink p-2 text-ink-foreground">
          {showAccountStrip && account?.name ? (
            <div className="mb-1 flex items-center gap-2 px-3 pt-2 text-xs text-ink-muted">
              <UsersRound className="size-3.5 shrink-0" />
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole
                ? (() => {
                    const meta = ROLE_CHIP[accountRole];
                    const Icon = meta.icon;
                    return (
                      <span
                        className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                      >
                        <Icon className="size-3" />
                        {t(meta.labelKey)}
                      </span>
                    );
                  })()
                : null}
            </div>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-white/5 focus:outline-none data-popup-open:bg-white/5">
              <Avatar className="size-9 shrink-0 ring-2 ring-highlight">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? t("defaultAvatar")}
                  />
                ) : null}
                <AvatarFallback className="bg-highlight text-sm font-medium text-highlight-foreground">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {profile?.full_name ?? t("defaultUser")}
                </p>
                <p className="truncate text-xs text-ink-muted">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
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
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
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
      </aside>
    </>
  );
}
