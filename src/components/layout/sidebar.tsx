"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import {
  BarChart3,
  Bell,
  Bot,
  Car,
  ChevronDown,
  CirclePlus,
  FileBarChart,
  LayoutTemplate,
  Link2,
  Megaphone,
  Plug,
  Crown,
  GitBranch,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Radio,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  X,
  Zap,
  Sun,
  CheckCheck,
} from "lucide-react";
import { hasMinRole, type AccountRole } from "@/lib/auth/roles";

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: "roleOwner",
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  admin: {
    icon: Shield,
    labelKey: "roleAdmin",
    // Primary-tinted: significant but not as scarce as owner.
    className:
      "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    labelKey: "roleAgent",
    // Neutral slate: the operational default.
    className:
      "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    labelKey: "roleViewer",
    // Muted slate: read-only role; visually quieter than agent.
    className:
      "border-border bg-card text-muted-foreground",
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

// ------------------------------------------------------------
// Menu do sistema único, por categoria: Início · CRM · Tráfego · Site ·
// Sistema. Tráfego e Site são módulos que vieram dos outros sistemas da
// loja; só aparecem quando a loja tem o módulo ligado (organizations.
// modules, migration 050) e para os papéis que usam aquela área.
// ------------------------------------------------------------
type ModuleKey = "trafego" | "estoque";

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  /** Rótulo "Beta" ao lado do nome (só informativo). */
  beta?: boolean;
  /** Papel mínimo para ver o item. Sem valor: todos da conta. */
  minRole?: AccountRole;
  /** Tela ainda em construção: mostra o rótulo "Em breve". */
  soon?: boolean;
  /** Só aparece quando a loja tem este módulo ligado. */
  module?: ModuleKey;
  /** Outras telas que acendem este item (ex.: as abas de Automações). */
  also?: string[];
}

interface NavSection {
  id: string;
  /** Null = sem título (o Início fica solto no topo). */
  labelKey: string | null;
  module?: ModuleKey;
  minRole?: AccountRole;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    id: "top",
    labelKey: null,
    items: [
      { href: "/hoje", labelKey: "today", icon: Sun },
      { href: "/patio", labelKey: "lot", icon: Car, module: "estoque" },
    ],
  },
  {
    id: "clientes",
    labelKey: "groups.clientes",
    items: [
      { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
      { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
      { href: "/contacts", labelKey: "contacts", icon: Users },
      { href: "/notifications", labelKey: "notifications", icon: Bell },
      { href: "/agents", labelKey: "aiAgents", icon: Bot },
      { href: "/dashboard", labelKey: "crmPanel", icon: LayoutDashboard },
    ],
  },
  {
    id: "marketing",
    labelKey: "groups.marketing",
    items: [
      { href: "/trafego", labelKey: "trafficOverview", icon: BarChart3, module: "trafego", minRole: "admin" },
      { href: "/trafego/campanhas", labelKey: "trafficCampaigns", icon: Megaphone, module: "trafego", minRole: "admin" },
      { href: "/trafego/carros", labelKey: "trafficCars", icon: Car, module: "trafego", minRole: "admin" },
      { href: "/trafego/links-utm", labelKey: "trafficUtm", icon: Link2, module: "trafego", minRole: "admin" },
      { href: "/trafego/conferir", labelKey: "trafficCheck", icon: CheckCheck, module: "trafego", minRole: "admin" },
      { href: "/broadcasts", labelKey: "broadcasts", icon: Radio },
      { href: "/automations", labelKey: "automations", icon: Zap, also: ["/regras", "/trafego/alertas", "/flows"] },
    ],
  },
  {
    id: "site",
    labelKey: "groups.site",
    module: "estoque",
    minRole: "admin",
    items: [
      { href: "/site/conteudo", labelKey: "siteContent", icon: LayoutTemplate },
      { href: "/site/links", labelKey: "siteLinks", icon: Link2 },
      { href: "/site/club", labelKey: "siteClub", icon: Crown },
      { href: "/ajustes/site", labelKey: "siteSettings", icon: Settings, module: "estoque" },
    ],
  },
  {
    id: "resultados",
    labelKey: "groups.resultados",
    minRole: "admin",
    items: [
      { href: "/resultados", labelKey: "report", icon: FileBarChart },
      { href: "/trafego/vendedores", labelKey: "trafficSellers", icon: UsersRound, module: "trafego" },
    ],
  },
  {
    id: "ajustes",
    labelKey: "groups.ajustes",
    items: [
      { href: "/settings", labelKey: "settings", icon: Settings },
      { href: "/ajustes/conexoes", labelKey: "trafficConnections", icon: Plug, module: "estoque", minRole: "admin" },
      { href: "/ajustes/equipe", labelKey: "team", icon: UserCog, module: "estoque", minRole: "admin" },
      { href: "/trafego/importar", labelKey: "importData", icon: CirclePlus, module: "trafego", minRole: "admin" },
    ],
  },
];

const SECTIONS_STORAGE_KEY = "wacrm.sidebar.fechadas";

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

import { useTranslations } from "next-intl";

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut, branding } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();

  // Categorias visíveis para esta pessoa: módulo ligado na loja + papel.
  const visibleSections = NAV_SECTIONS.map((section) => {
    const podeSecao =
      (!section.module || branding?.modules?.[section.module] === true) &&
      (!section.minRole || (accountRole !== null && hasMinRole(accountRole, section.minRole)));
    if (!podeSecao) return null;
    const items = section.items.filter(
      (item) =>
        (!item.module || branding?.modules?.[item.module] === true) &&
        (!item.minRole || (accountRole !== null && hasMinRole(accountRole, item.minRole))),
    );
    return items.length ? { ...section, items } : null;
  }).filter((s): s is NavSection => s !== null);

  // Categorias recolhidas (guardado só neste navegador).
  const [fechadas, setFechadas] = useState<string[]>([]);
  useEffect(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(SECTIONS_STORAGE_KEY) ?? "[]");
      if (Array.isArray(salvo)) setFechadas(salvo.filter((x) => typeof x === "string"));
    } catch {
      // localStorage indisponível: tudo aberto.
    }
  }, []);
  const alternarSecao = (id: string) => {
    setFechadas((atual) => {
      const nova = atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id];
      try {
        localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(nova));
      } catch {
        // ignora
      }
      return nova;
    });
  };
  // Only surface the account-name strip when it actually carries
  // information. A solo user's personal account is named after them
  // (the 017 signup trigger seeds it from `full_name`), so showing it
  // here would just duplicate the user name in the footer below. Once
  // the account is renamed or the user joins a shared account, the
  // name diverges and the strip becomes meaningful — that's the signal
  // we gate on. Wait for the profile fetch to settle first, otherwise
  // the strip flashes in once the row resolves (a layout jump).
  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

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
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-border bg-card",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          "lg:static lg:z-0 lg:w-60 lg:translate-x-0 lg:transition-none",
        )}
        aria-label="Principal"
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible. */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
            {branding?.logoUrl ? (
              // Logo da loja (marca própria, migration 050).
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logoUrl}
                alt={branding.name ?? t("title")}
                className="h-9 w-auto max-w-[150px] object-contain"
              />
            ) : (
              <>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <span className="truncate text-sm font-semibold text-foreground">
                  {branding?.name ?? t("title")}
                </span>
              </>
            )}
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Menu por categoria. Cada categoria abre e fecha; a escolha
            fica guardada neste navegador. */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {visibleSections.map((section) => {
            const fechada = section.labelKey !== null && fechadas.includes(section.id);
            return (
              <div key={section.id} className="mb-1">
                {section.labelKey ? (
                  <button
                    type="button"
                    onClick={() => alternarSecao(section.id)}
                    aria-expanded={!fechada}
                    className="flex w-full items-center gap-2 rounded-md px-3 pt-3 pb-1.5 text-left text-[11px] font-semibold tracking-[0.12em] text-primary uppercase hover:text-primary-hover"
                  >
                    <span className="flex-1">{t(section.labelKey)}</span>
                    <ChevronDown
                      className={cn(
                        "size-3.5 text-muted-foreground transition-transform",
                        fechada && "-rotate-90",
                      )}
                    />
                  </button>
                ) : null}
                {fechada ? null : (
                  <ul className="flex flex-col gap-1">
                    {section.items.map((item) => {
                      const isActive =
                        pathname === item.href ||
                        (item.href !== "/dashboard" &&
                          item.href !== "/trafego" &&
                          pathname.startsWith(item.href)) ||
                        !!item.also?.some((p) => pathname === p || pathname.startsWith(p + "/"));

                      const showUnreadDot =
                        item.href === "/inbox" && totalUnread > 0 && !isActive;

                      // O contador de notificações continua visível mesmo
                      // com a página aberta — reflete o que não foi lido.
                      const showNotificationBadge =
                        item.href === "/notifications" && unreadNotifications > 0;

                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={cn(
                              // Mais alto no celular para o dedo acertar (≥44px).
                              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                              isActive
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            <item.icon className="h-4 w-4" />
                            <span className="flex-1">{t(item.labelKey as string)}</span>
                            {item.beta && (
                              <span
                                aria-label={t("beta")}
                                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300"
                              >
                                {t("beta")}
                              </span>
                            )}
                            {item.soon && (
                              <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {t("soon")}
                              </span>
                            )}
                            {showUnreadDot && (
                              <span
                                aria-label={t("unreadConversations", { count: totalUnread })}
                                className="relative flex h-2 w-2"
                              >
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                              </span>
                            )}
                            {showNotificationBadge && (
                              <span
                                aria-label={t("unreadNotifications", { count: unreadNotifications })}
                                className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                              >
                                {unreadNotifications > 9 ? "9+" : unreadNotifications}
                              </span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        {/* User section */}
        <div className="shrink-0 border-t border-border p-3">
          {/* Account name display — surfaced only when the account
              name differs from the user's own name (see
              `showAccountStrip`). For a default solo account the two
              match, so we hide it to avoid duplicating the user name
              below; for renamed or shared accounts it tells the user
              which account they're acting in. */}
          {showAccountStrip && account?.name ? (
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
                      {t(meta.labelKey as string)}
                    </span>
                  );
                })()
              ) : null}
            </div>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:outline-none data-popup-open:bg-muted/60">
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? t("defaultAvatar")}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {profile?.full_name ?? t("defaultUser")}
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
              className="min-w-56 bg-popover text-popover-foreground ring-border"
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
