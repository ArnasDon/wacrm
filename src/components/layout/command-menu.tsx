"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  IconBell,
  IconBolt,
  IconBuilding,
  IconCalendarEvent,
  IconGitBranch,
  IconLayoutDashboard,
  IconLogout,
  IconMessage,
  IconMoon,
  IconPackage,
  IconPlus,
  IconRobot,
  IconSettings,
  IconSitemap,
  IconSpeakerphone,
  IconSun,
  IconTrendingUp,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";

import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

/**
 * ⌘K command menu — quick navigation + global actions, modelled on
 * Twenty's (twentyhq/twenty) command menu. Opens on ⌘K / Ctrl+K, or
 * when any control dispatches the `open-command-menu` window event
 * (see the header's search button).
 *
 * Mounted once, headless, from the dashboard shell. Deeper record-
 * scoped actions (create quote, move deal…) come with the record
 * table / detail panel in a later step.
 */

const OPEN_EVENT = "open-command-menu";

/** Fire from anywhere to open the palette without prop-drilling. */
export function openCommandMenu() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface NavEntry {
  href: string;
  labelKey: string;
  icon: Icon;
}

const NAV: NavEntry[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: IconLayoutDashboard },
  { href: "/kpis", labelKey: "kpis", icon: IconTrendingUp },
  { href: "/inbox", labelKey: "inbox", icon: IconMessage },
  { href: "/notifications", labelKey: "notifications", icon: IconBell },
  { href: "/contacts", labelKey: "contacts", icon: IconUsers },
  { href: "/pipelines", labelKey: "pipelines", icon: IconGitBranch },
  { href: "/calendar", labelKey: "calendar", icon: IconCalendarEvent },
  { href: "/products", labelKey: "products", icon: IconPackage },
  { href: "/broadcasts", labelKey: "broadcasts", icon: IconSpeakerphone },
  { href: "/automations", labelKey: "automations", icon: IconBolt },
  { href: "/flows", labelKey: "flows", icon: IconSitemap },
  { href: "/agents", labelKey: "aiAgents", icon: IconRobot },
  { href: "/settings", labelKey: "settings", icon: IconSettings },
];

export function CommandMenu() {
  const router = useRouter();
  const tNav = useTranslations("Sidebar");
  const t = useTranslations("CommandMenu");
  const { isPlatformAdmin, signOut } = useAuth();
  const { mode, toggleMode } = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  const run = useCallback((action: () => void) => {
    setOpen(false);
    // Let the dialog close before navigating / mutating so focus
    // returns cleanly.
    setTimeout(action, 0);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t("placeholder")} />
      <CommandList>
        <CommandEmpty>{t("empty")}</CommandEmpty>

        <CommandGroup heading={t("goTo")}>
          {NAV.map((item) => (
            <CommandItem
              key={item.href}
              value={`${tNav(item.labelKey)} ${item.href}`}
              onSelect={() => run(() => router.push(item.href))}
            >
              <item.icon />
              {tNav(item.labelKey)}
            </CommandItem>
          ))}
          {isPlatformAdmin ? (
            <CommandItem
              value="plataforma platform admin /admin"
              onSelect={() => run(() => router.push("/admin"))}
            >
              <IconBuilding />
              {t("platform")}
            </CommandItem>
          ) : null}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("actions")}>
          <CommandItem
            value={t("newContact")}
            onSelect={() => run(() => router.push("/contacts?new=1"))}
          >
            <IconPlus />
            {t("newContact")}
          </CommandItem>
          <CommandItem
            value={`${t("switchToLight")} ${t("switchToDark")}`}
            onSelect={() => run(toggleMode)}
          >
            {mode === "dark" ? <IconSun /> : <IconMoon />}
            {t(mode === "dark" ? "switchToLight" : "switchToDark")}
          </CommandItem>
          <CommandItem
            value={t("signOut")}
            onSelect={() => run(signOut)}
          >
            <IconLogout />
            {t("signOut")}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
