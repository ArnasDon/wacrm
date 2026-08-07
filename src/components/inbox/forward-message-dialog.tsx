"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Search, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { Contact, Message } from "@/types";

interface ForwardMessageDialogProps {
  /** The message being forwarded. Null hides the dialog. */
  message: Message | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ForwardResult {
  contact_id: string;
  success: boolean;
  error?: string;
}

/**
 * "Encaminhar" — pick one or more existing CRM contacts to re-send the
 * selected message to. Each target's conversation is found-or-created
 * server-side (`/api/whatsapp/forward`), same as any other outbound send.
 */
export function ForwardMessageDialog({
  message,
  open,
  onOpenChange,
}: ForwardMessageDialogProps) {
  const t = useTranslations("Inbox.forward");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  // Reset selection/search and (re)load the contact list every time the
  // dialog opens — cheap enough not to bother caching across opens.
  useEffect(() => {
    if (!open) return;
    setSelectedIds([]);
    setSearch("");
    setLoadingContacts(true);
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, name, phone, avatar_url")
        .order("name");
      if (cancelled) return;
      if (error) {
        console.error("Failed to load contacts for forward:", error.message);
      }
      setContacts((data as Contact[]) ?? []);
      setLoadingContacts(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q),
    );
  }, [contacts, search]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const handleForward = useCallback(async () => {
    if (!message || selectedIds.length === 0) return;
    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_id: message.id,
          contact_ids: selectedIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("toastFailed"));
        return;
      }

      const results = (data.results ?? []) as ForwardResult[];
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.length - successCount;

      if (failCount === 0) {
        toast.success(t("toastForwarded", { count: successCount }));
      } else if (successCount === 0) {
        toast.error(t("toastAllFailed"));
      } else {
        toast.warning(
          t("toastPartial", { success: successCount, failed: failCount }),
        );
      }
      onOpenChange(false);
    } catch {
      toast.error(t("toastFailed"));
    } finally {
      setSending(false);
    }
  }, [message, selectedIds, t, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-9"
          />
        </div>

        {loadingContacts ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("noContacts")}
          </p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {filtered.map((c) => {
              const label = c.name || c.phone || t("unknownContact");
              return (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selectedIds.includes(c.id)}
                    onCheckedChange={() => toggle(c.id)}
                    aria-label={label}
                  />
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-foreground">
                    {c.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.avatar_url}
                        alt=""
                        className="h-7 w-7 rounded-full object-cover"
                      />
                    ) : (
                      label.charAt(0).toUpperCase()
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {label}
                    </span>
                    {c.name && c.phone && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {c.phone}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
            {t("cancel")}
          </Button>
          <Button onClick={handleForward} disabled={sending || selectedIds.length === 0}>
            {sending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("forwardButton", { count: selectedIds.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
