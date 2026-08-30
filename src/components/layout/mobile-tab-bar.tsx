"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  IconLayoutDashboard,
  IconMessage,
  IconUsers,
  IconGitBranch,
  IconDots,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useTotalUnread } from "@/hooks/use-total-unread";

const tabs = [
  { href: "/dashboard", labelKey: "dashboard", icon: IconLayoutDashboard },
  { href: "/inbox", labelKey: "inbox", icon: IconMessage },
  { href: "/contacts", labelKey: "contacts", icon: IconUsers },
  { href: "/pipelines", labelKey: "pipelines", icon: IconGitBranch },
  { href: "/settings", labelKey: "settings", icon: IconDots },
] as const;

export function MobileTabBar() {
  const pathname = usePathname();
  const t = useTranslations("Sidebar");
  const unread = useTotalUnread();

  return (
    <nav
      aria-label="Navegación principal móvil"
      className="mobile-tab-bar fixed inset-x-0 bottom-0 z-20 border-t border-border/80 bg-background/95 px-2 backdrop-blur-xl lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href ||
            (tab.href !== "/dashboard" && pathname.startsWith(tab.href));
          const showUnread = tab.href === "/inbox" && unread > 0;

          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-medium transition-colors active:scale-95",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span className={cn("relative rounded-full px-4 py-1", active && "bg-primary-soft")}>
                  <tab.icon className="size-5" stroke={active ? 2.4 : 1.9} />
                  {showUnread && (
                    <span className="absolute right-2 top-0 size-2.5 rounded-full border-2 border-background bg-primary" />
                  )}
                </span>
                <span className="max-w-full truncate">{t(tab.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
