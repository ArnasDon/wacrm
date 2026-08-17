"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Loader2, UserPlus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Notification } from "@/types";

// Only one notification type exists today (conversation_assigned).
const TYPE_ICON: Record<Notification["type"], typeof Bell> = {
  conversation_assigned: UserPlus,
};

/**
 * Conversation-assignment alerts, unchanged from the old standalone
 * "Notificações" page (data/RLS/realtime all identical) — just
 * relocated into a compact header bell now that the tab's main
 * surface is the Central de Ações. Nothing about this feature was
 * dropped, only its screen real estate.
 */
export function AssignedNotificationsPopover() {
  const t = useTranslations("Notifications.page");
  const appLocale = useLocale();
  const dateFnsLocale = getDateFnsLocale(appLocale);
  const router = useRouter();
  const { accountId } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(30);
    setNotifications((data ?? []) as Notification[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("action-center-notifications-bell")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Notification;
            setNotifications((prev) => {
              if (!prev) return [row];
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as Notification;
            setNotifications((prev) => prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ?? prev);
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications((prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      setNotifications(
        (prev) => prev?.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n)) ?? prev,
      );
      const supabase = createClient();
      const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
      if (error) {
        toast.error(t("toastMarkReadError"));
        load();
      }
    },
    [load, t],
  );

  const handleClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) markRead(n.id);
      setOpen(false);
      if (n.conversation_id) router.push(`/inbox?c=${n.conversation_id}`);
    },
    [markRead, router, setOpen],
  );

  const unreadIds = notifications?.filter((n) => !n.read_at).map((n) => n.id) ?? [];

  const markAllRead = useCallback(async () => {
    if (unreadIds.length === 0) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    setNotifications((prev) => prev?.map((n) => (n.read_at ? n : { ...n, read_at: now })) ?? prev);
    const supabase = createClient();
    const { error } = await supabase.from("notifications").update({ read_at: now }).is("read_at", null);
    setMarkingAll(false);
    if (error) {
      toast.error(t("toastMarkAllError"));
      load();
    }
  }, [unreadIds.length, load, t]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="icon-sm" className="relative" aria-label={t("title")} title={t("title")} />
        }
      >
        <Bell className="h-4 w-4" />
        {unreadIds.length > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
            {unreadIds.length > 9 ? "9+" : unreadIds.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-semibold text-foreground">{t("title")}</p>
          <Button variant="ghost" size="sm" disabled={unreadIds.length === 0 || markingAll} onClick={markAllRead}>
            {markingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
            {t("markAllRead")}
          </Button>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {notifications === null ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          ) : notifications.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t("emptyTitle")}</p>
          ) : (
            <ul className="space-y-1">
              {notifications.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const isUnread = !n.read_at;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleClick(n)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg p-2 text-left transition-colors",
                        isUnread ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                          isUnread ? "bg-primary/15" : "bg-muted",
                        )}
                      >
                        <Icon className={cn("h-3.5 w-3.5", isUnread ? "text-primary" : "text-muted-foreground")} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-xs font-medium", isUnread ? "text-foreground" : "text-muted-foreground")}>
                          {n.title}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: dateFnsLocale })}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
