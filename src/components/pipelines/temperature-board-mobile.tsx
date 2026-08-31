"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Contact, LeadTemperature } from "@/types";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TEMPERATURE_COLUMNS,
  SETTABLE_TEMPERATURES,
  type ColumnKey,
} from "./temperature-columns";

interface TemperatureBoardMobileProps {
  contactsByColumn: Map<ColumnKey, Contact[]>;
  onContactMoved: (contactId: string, temperature: LeadTemperature) => void;
  onOpenChat?: (contactId: string) => void;
}

/**
 * Phone/tablet temperature board: a column-tab row (nav only) + the
 * selected column's chats as a vertical list. Reclassify a chat with
 * its "Cambiar a" menu — same `onContactMoved` path as the desktop
 * drag. "Sin clasificar" is a viewable tab but not a move target
 * (mirrors the desktop board).
 */
export function TemperatureBoardMobile({
  contactsByColumn,
  onContactMoved,
  onOpenChat,
}: TemperatureBoardMobileProps) {
  const t = useTranslations("Pipelines.temperature");

  const [activeKey, setActiveKey] = useState<ColumnKey>(
    TEMPERATURE_COLUMNS[0].key,
  );

  // Columns are static, so `activeKey` is always valid — but keep the
  // guard symmetric with the pipeline mobile view.
  useEffect(() => {
    if (!TEMPERATURE_COLUMNS.some((c) => c.key === activeKey)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveKey(TEMPERATURE_COLUMNS[0].key);
    }
  }, [activeKey]);

  const activeColumn = useMemo(
    () => TEMPERATURE_COLUMNS.find((c) => c.key === activeKey) ?? null,
    [activeKey],
  );
  const contacts = activeColumn
    ? (contactsByColumn.get(activeColumn.key) ?? [])
    : [];

  if (!activeColumn) return null;
  const ActiveIcon = activeColumn.icon;

  return (
    <div className="flex flex-col gap-3 pb-4">
      {/* Column tabs — horizontal scroll, navigation only. */}
      <div
        role="tablist"
        aria-label={t("columnTabsLabel")}
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
      >
        {TEMPERATURE_COLUMNS.map((col) => {
          const count = contactsByColumn.get(col.key)?.length ?? 0;
          const isActive = col.key === activeKey;
          const Icon = col.icon;
          return (
            <button
              key={col.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveKey(col.key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="size-3.5" style={{ color: col.color }} />
              <span className="whitespace-nowrap">{t(col.key)}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-semibold",
                  isActive
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <h3 className="flex items-center gap-1.5 px-1 text-sm font-semibold text-foreground">
        <ActiveIcon className="size-3.5" style={{ color: activeColumn.color }} />
        {t(activeColumn.key)}
      </h3>

      <div className="flex flex-col gap-2">
        {contacts.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border py-10 text-center text-xs text-muted-foreground">
            {t("noContactsYet")}
          </div>
        ) : (
          contacts.map((contact) => {
            const label =
              contact.name ||
              contact.phone ||
              contact.instagram_username ||
              t("noName");
            return (
              <div
                key={contact.id}
                className="rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {label}
                    </p>
                    {contact.phone ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {contact.phone}
                      </p>
                    ) : null}
                  </div>
                  {onOpenChat ? (
                    <button
                      type="button"
                      aria-label={t("openChat")}
                      title={t("openChat")}
                      onClick={() => onOpenChat(contact.id)}
                      className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary"
                    >
                      <MessageCircle className="size-3.5" />
                    </button>
                  ) : null}
                </div>

                <div className="mt-2 flex justify-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={t("changeContactTemp", { name: label })}
                    >
                      <ArrowRight className="size-3.5" />
                      {t("changeTo")}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-44">
                      {/* base-ui's Menu.GroupLabel (DropdownMenuLabel)
                          THROWS at render without a Menu.Group ancestor —
                          see dropdown-menu-group-label.test.tsx / #336. */}
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>{t("changeTo")}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {SETTABLE_TEMPERATURES.map((temp) => {
                          const meta = TEMPERATURE_COLUMNS.find(
                            (c) => c.key === temp,
                          );
                          const Icon = meta?.icon;
                          return (
                            <DropdownMenuItem
                              key={temp}
                              disabled={contact.lead_temperature === temp}
                              onClick={() => {
                                if (contact.lead_temperature !== temp) {
                                  onContactMoved(contact.id, temp);
                                }
                              }}
                            >
                              {Icon ? (
                                <Icon
                                  className="size-3.5"
                                  style={{ color: meta?.color }}
                                />
                              ) : null}
                              {t(temp)}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
