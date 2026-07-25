"use client";

import { COPYRIGHT_NOTICE } from "@/lib/brand";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { useAuth } from "@/hooks/use-auth";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useTotalUnread } from "@/hooks/use-total-unread";
import {
  ChevronDown,
  CreditCard,
  Crown,
  FileText,
  GitBranch,
  Headset,
  LayoutDashboard,
  List,
  Lock,
  LogOut,
  Mail,
  Megaphone,
  MessageSquare,
  KeyRound,
  Link2,
  Phone,
  Radio,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  BookOpen,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; label: string; className: string }
> = {
  owner: {
    icon: Crown,
    label: "Owner",
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-700",
  },
  admin: {
    icon: Shield,
    label: "Admin",
    // Primary-tinted: significant but not as scarce as owner.
    className:
      "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    label: "Agent",
    className:
      "border-border bg-muted text-muted-foreground",
  },
  viewer: {
    icon: User,
    label: "Viewer",
    className:
      "border-border bg-muted/60 text-muted-foreground",
  },
};
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

interface NavChild {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Open in a new browser tab (external support / marketing links). */
  external?: boolean;
  /** Nested links under this parent (e.g. Email). */
  children?: NavChild[];
  /** Subscription capability required; shows a lock when unavailable. */
  capability?:
    | "messaging"
    | "contacts"
    | "pipelines"
    | "broadcasts"
    | "automations"
    | "flows"
    | "team"
    | "compliance"
    | "email_marketing"
    | "whatsapp"
    | "templates";
}

const whatsappChildren: NavChild[] = [
  { href: "/whatsapp", label: "Overview", icon: LayoutDashboard },
  { href: "/whatsapp/config", label: "Connection", icon: Link2 },
  { href: "/whatsapp/templates", label: "Templates", icon: FileText },
  { href: "/whatsapp/app-secret", label: "App Secret", icon: KeyRound },
];

const emailChildren: NavChild[] = [
  { href: "/email", label: "Overview", icon: LayoutDashboard },
  { href: "/email/lists", label: "Lists", icon: List },
  { href: "/email/templates", label: "Templates", icon: FileText },
  { href: "/email/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/email/smtp", label: "SMTP", icon: Server },
];

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: MessageSquare, capability: "messaging" },
  { href: "/contacts", label: "Contacts", icon: Users, capability: "contacts" },
  { href: "/pipelines", label: "Pipelines", icon: GitBranch, capability: "pipelines" },
  { href: "/broadcasts", label: "Broadcasts", icon: Radio, capability: "broadcasts" },
  {
    href: "/whatsapp",
    label: "WhatsApp",
    icon: Phone,
    capability: "whatsapp",
    children: whatsappChildren,
  },
  {
    href: "/email",
    label: "Email",
    icon: Mail,
    capability: "email_marketing",
    children: emailChildren,
  },
  { href: "/automations", label: "Automations", icon: Zap, capability: "automations" },
  { href: "/flows", label: "Flows", icon: Workflow, capability: "flows" },
  {
    href: "/compliance",
    label: "Compliance",
    icon: ShieldCheck,
    capability: "compliance",
  },
];

/** Parent overview hrefs that should not match every nested child path. */
const EXACT_PARENT_HREFS = new Set(["/dashboard", "/email", "/whatsapp"]);

function pathMatches(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (EXACT_PARENT_HREFS.has(href)) return false;
  return pathname.startsWith(`${href}/`);
}

function parentActive(pathname: string, item: NavItem): boolean {
  if (!item.children?.length) {
    return (
      pathname === item.href ||
      (item.href !== "/dashboard" && pathname.startsWith(item.href))
    );
  }
  return item.children.some((child) => pathMatches(pathname, child.href));
}

const bottomNavItems: NavItem[] = [
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/docs/getting-started", label: "Docs", icon: BookOpen },
  {
    href: "https://www.vedmint.com/contact",
    label: "Support",
    icon: Headset,
    external: true,
  },
  { href: "/settings?tab=members", label: "Team", icon: UsersRound, capability: "team" },
  // Explicit profile tab — avoids stale ?tab=templates redirects from old links.
  { href: "/settings?tab=profile", label: "Settings", icon: Settings },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

// Same flag key the Members tab and Settings page use. Flip per
// profile via Supabase Studio to dogfood the multi-user surface.
const ACCOUNT_SHARING_FLAG = "account_sharing";

export function Sidebar({ open = false, onClose }: SidebarProps) {
  return (
    <Suspense fallback={<aside className="hidden w-60 border-r border-sidebar-border bg-sidebar lg:block" />}>
      <SidebarInner open={open} onClose={onClose} />
    </Suspense>
  );
}

function SidebarInner({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const { canUse, active, configured, loading: entitlementsLoading } =
    useEntitlements();
  const totalUnread = useTotalUnread();
  const settingsTab = searchParams.get("tab") || "profile";
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const item of navItems) {
      if (item.children?.length && parentActive(pathname, item)) {
        initial[item.href] = true;
      }
    }
    return initial;
  });

  useEffect(() => {
    setOpenMenus((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of navItems) {
        if (item.children?.length && parentActive(pathname, item) && !next[item.href]) {
          next[item.href] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [pathname]);

  const planLocked = (capability?: NavItem["capability"]) => {
    if (!capability || entitlementsLoading || !configured) return false;
    if (!active) return true;
    return !canUse(capability);
  };
  // Match the settings page's check: only treat the flag as enabled
  // once the profile has finished loading. Without this, the strip
  // would briefly flash absent during the initial profile fetch
  // (when `profile` is null and the boolean coerces to false), then
  // pop in once the row resolves — visible as a layout jump in the
  // sidebar footer.
  const accountSharingEnabled =
    !profileLoading &&
    !!profile?.beta_features?.includes(ACCOUNT_SHARING_FLAG);

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
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

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label="Close menu"
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
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          "lg:static lg:z-0 lg:w-60 lg:translate-x-0 lg:transition-none",
        )}
        aria-label="Primary"
      >
        {/* Logo row — symmetric 3-column grid keeps wordmark visually centered. */}
        <div className="grid shrink-0 grid-cols-[2.25rem_1fr_2.25rem] items-center border-b border-sidebar-border px-2 py-3.5">
          <div aria-hidden="true" />
          <Link
            href="/dashboard"
            className="col-start-2 flex justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 rounded-md"
          >
            <Logo variant="sidebar" />
          </Link>
          <div className="col-start-3 flex items-center justify-end">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground lg:hidden"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Main navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive = parentActive(pathname, item);
              const showUnreadDot =
                item.href === "/inbox" && totalUnread > 0 && !isActive;
              const locked = planLocked(item.capability);
              const hasChildren = Boolean(item.children?.length);

              if (hasChildren && item.children) {
                const menuOpen = Boolean(openMenus[item.href]);
                return (
                  <li key={item.href}>
                    <div
                      className={cn(
                        "flex items-center rounded-lg transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                        locked && "opacity-80",
                      )}
                    >
                      <Link
                        href={item.href}
                        title={
                          locked
                            ? "Requires an active subscription plan — open Billing to upgrade"
                            : undefined
                        }
                        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-sm font-medium lg:py-2"
                        onClick={() =>
                          setOpenMenus((prev) => ({
                            ...prev,
                            [item.href]: true,
                          }))
                        }
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 truncate">{item.label}</span>
                        {locked ? (
                          <Lock
                            className="h-3.5 w-3.5 text-amber-600"
                            aria-label="Locked by plan"
                          />
                        ) : null}
                      </Link>
                      <button
                        type="button"
                        aria-label={
                          menuOpen
                            ? `Collapse ${item.label} menu`
                            : `Expand ${item.label} menu`
                        }
                        aria-expanded={menuOpen}
                        onClick={() =>
                          setOpenMenus((prev) => ({
                            ...prev,
                            [item.href]: !prev[item.href],
                          }))
                        }
                        className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-sidebar-accent"
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform",
                            menuOpen ? "rotate-0" : "-rotate-90",
                          )}
                        />
                      </button>
                    </div>
                    {menuOpen ? (
                      <ul className="mt-0.5 ml-3 space-y-0.5 border-l border-sidebar-border pl-2">
                        {item.children.map((child) => {
                          const childActive = pathMatches(
                            pathname,
                            child.href,
                          );
                          return (
                            <li key={`${child.href}-${child.label}`}>
                              <Link
                                href={child.href}
                                className={cn(
                                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors lg:py-1.5",
                                  childActive
                                    ? "bg-primary/10 font-medium text-primary"
                                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                                )}
                              >
                                <child.icon className="h-3.5 w-3.5 shrink-0" />
                                <span>{child.label}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              }

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={
                      locked
                        ? "Requires an active subscription plan — open Billing to upgrade"
                        : undefined
                    }
                    className={cn(
                      // Taller on mobile so fingers can hit the row reliably (≥44px).
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                      locked && "opacity-80",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="flex-1">{item.label}</span>
                    {locked && (
                      <Lock
                        className="h-3.5 w-3.5 text-amber-600"
                        aria-label="Locked by plan"
                      />
                    )}
                    {showUnreadDot && (
                      <span
                        aria-label={`${totalUnread} unread conversation${totalUnread === 1 ? "" : "s"}`}
                        className="relative flex h-2 w-2"
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="my-4 border-t border-sidebar-border" />

          <ul className="flex flex-col gap-1">
            {bottomNavItems.map((item) => {
              const hrefPath = item.href.split("?")[0] ?? item.href;
              const hrefTab = item.href.includes("tab=")
                ? new URL(item.href, "http://local").searchParams.get("tab")
                : null;
              // Team (?tab=members) and Settings (?tab=profile) share /settings —
              // match the tab so each item highlights correctly.
              const isActive = item.external
                ? false
                : item.href.startsWith("/docs")
                  ? pathname.startsWith("/docs")
                  : hrefPath === "/settings" && hrefTab
                    ? pathname === "/settings" && settingsTab === hrefTab
                    : pathname === hrefPath ||
                      (hrefPath !== "/" &&
                        hrefPath !== "/settings" &&
                        pathname.startsWith(`${hrefPath}/`));
              const locked = planLocked(item.capability);
              const className = cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                locked && "opacity-80",
              );
              const lockIcon = locked ? (
                <Lock
                  className="h-3.5 w-3.5 text-amber-600"
                  aria-label="Locked by plan"
                />
              ) : null;

              return (
                <li key={`${item.href}-${item.label}`}>
                  {item.external ? (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open VedMint support contact in a new tab"
                      className={className}
                      onClick={onClose}
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="flex-1">{item.label}</span>
                    </a>
                  ) : (
                    <Link
                      href={item.href}
                      title={
                        locked
                          ? "Requires an active subscription plan — open Billing to upgrade"
                          : undefined
                      }
                      className={className}
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="flex-1">{item.label}</span>
                      {lockIcon}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User section */}
        <div className="shrink-0 border-t border-sidebar-border p-3">
          {/* Account name display — only surfaced when the user is
              opted into the account_sharing beta flag. For solo
              users (the default) the account is named after them,
              so showing it here would just duplicate the user name
              below. Once the flag is on the user is at minimum
              aware of which shared account they're acting in. */}
          {accountSharingEnabled && account?.name ? (
            <div className="mb-2 flex items-center gap-2 px-3 text-xs text-muted-foreground">
              <UsersRound className="size-3.5 shrink-0" />
              {/* `title=` exposes the full name on hover when it
                  gets truncated (long account names + narrow
                  sidebars). Cheap a11y win. */}
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole ? (
                // Always render the chip — owners used to be
                // invisible here, which made them indistinguishable
                // from admins at a glance. Now everyone sees their
                // role (with a colour cue) regardless of tier.
                (() => {
                  const meta = ROLE_CHIP[accountRole];
                  const Icon = meta.icon;
                  return (
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                    >
                      <Icon className="size-3" />
                      {meta.label}
                    </span>
                  );
                })()
              ) : null}
            </div>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-sidebar-accent focus:bg-sidebar-accent focus:outline-none data-popup-open:bg-sidebar-accent">
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? "Avatar"}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-sidebar-foreground">
                  {profile?.full_name ?? "User"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                  />
                }
              >
                <User className="size-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/whatsapp/config"
                    onClick={onClose}
                  />
                }
              >
                <Phone className="size-4" />
                WhatsApp
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                  />
                }
              >
                <Settings className="size-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
         </div>
         <div className="border-t border-sidebar-border p-3 text-center">
           <p className="text-[10px] text-muted-foreground">
             {COPYRIGHT_NOTICE}
           </p>
         </div>
       </aside>
    </>
  );
}
