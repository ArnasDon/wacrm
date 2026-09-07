"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Loader2,
  Search,
  Send,
  ExternalLink,
  IndianRupee,
  Image as ImageIcon,
  Sparkles,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from "@/lib/storage/upload-media";
import { CHAT_MEDIA_BUCKET } from "./message-composer";

/** Canned reply for a resolved order — fills in the payment ID so the
 *  agent doesn't have to retype the re-download instructions by hand. */
function buildOrderFoundMessage(paymentId: string): string {
  return `✅ We found your order!\n\nYour Payment ID:\n${paymentId}\n\nGo back to the website where you purchased your biodata and open the Download/Support section there. Paste this Payment ID exactly as shown above (including "pay_") to re-download your biodata.`;
}

interface OrderSearchResult {
  id: number;
  transactionId: string | null;
  utr: string | null;
  mobile: string | null;
  personName: string | null;
  email: string | null;
  amount: string | null;
  site: string | null;
  type: string | null;
  template: string | null;
  downloaded: number;
  createdOn: string;
}

interface OrderSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with a conversation id — after a message is sent, or when
   *  the agent clicks "Open conversation" — so the caller can select
   *  the thread the way a normal conversation click would. */
  onOpenConversation: (conversationId: string) => void;
  /**
   * The conversation currently open behind this dialog, if any. When
   * set, "Send" delivers straight into this thread instead of resolving
   * a conversation from the order's mobile number — that lookup can
   * land on a different contact/conversation than the one the agent is
   * actually looking at, which would otherwise send the message to the
   * wrong thread.
   */
  activeConversationId?: string | null;
}

// Debounce a search-as-you-type input against the external orders DB
// without hammering it on every keystroke.
const SEARCH_DEBOUNCE_MS = 300;

export function OrderSearchDialog({
  open,
  onOpenChange,
  onOpenConversation,
  activeConversationId,
}: OrderSearchDialogProps) {
  const t = useTranslations("Inbox.orderSearch");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OrderSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<OrderSearchResult | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [opening, setOpening] = useState(false);
  const [attachedImage, setAttachedImage] = useState<{ url: string; path: string } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  // Mirror of `attachedImage` for the close/unmount cleanup below, which
  // can't read render state.
  const attachedImageRef = useRef<{ url: string; path: string } | null>(null);
  useEffect(() => {
    attachedImageRef.current = attachedImage;
  }, [attachedImage]);

  // Reset to a clean slate every time the dialog opens, and autofocus
  // the search box so the shortcut goes straight to typing. On close,
  // GC any staged-but-unsent image so it doesn't orphan in the bucket.
  useEffect(() => {
    if (!open) {
      const staged = attachedImageRef.current;
      if (staged) void deleteAccountMedia(CHAT_MEDIA_BUCKET, staged.path).catch(() => {});
      setAttachedImage(null);
      return;
    }
    setQuery("");
    setResults([]);
    setSearched(false);
    setSelected(null);
    setMessage("");
    setAttachedImage(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    return () => {
      const staged = attachedImageRef.current;
      if (staged) void deleteAccountMedia(CHAT_MEDIA_BUCKET, staged.path).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]);
      setSearching(false);
      setSearched(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      fetch(`/api/orders/search?q=${encodeURIComponent(trimmed)}`)
        .then((res) => res.json())
        .then((data) => {
          if (requestId !== requestIdRef.current) return;
          setResults(Array.isArray(data.results) ? data.results : []);
          setSearched(true);
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          toast.error(t("searchError"));
        })
        .finally(() => {
          if (requestId !== requestIdRef.current) return;
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, t]);

  // Resolves the thread to send into: the conversation already open
  // behind this dialog, or — when opened from the global order search —
  // find-or-create one from the order's mobile number.
  const resolveTargetConversationId = useCallback(async (): Promise<string | null> => {
    if (activeConversationId) return activeConversationId;
    if (!selected?.mobile) return null;
    const res = await fetch("/api/orders/resolve-conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile: selected.mobile, name: selected.personName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? t("openError"));
      return null;
    }
    return data.conversation_id as string;
  }, [activeConversationId, selected, t]);

  const handleImageChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const max = MEDIA_MAX_BYTES_BY_KIND.image;
      if (file.size > max) {
        toast.error(t("imageTooLarge", { max: Math.round(max / 1024 / 1024) }));
        return;
      }
      setUploadingImage(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
        // Replacing a previously staged image — GC the one being dropped.
        if (attachedImageRef.current) {
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, attachedImageRef.current.path).catch(() => {});
        }
        setAttachedImage({ url: publicUrl, path });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("imageUploadError"));
      } finally {
        setUploadingImage(false);
      }
    },
    [t],
  );

  const removeAttachedImage = useCallback(() => {
    if (attachedImage) void deleteAccountMedia(CHAT_MEDIA_BUCKET, attachedImage.path).catch(() => {});
    setAttachedImage(null);
  }, [attachedImage]);

  const applyFoundTemplate = useCallback(() => {
    if (!selected) return;
    const paymentId = selected.transactionId || selected.utr || "";
    setMessage(buildOrderFoundMessage(paymentId));
  }, [selected]);

  const handleSend = useCallback(async () => {
    const trimmed = message.trim();
    if (!selected?.mobile || (!trimmed && !attachedImage) || sending) return;
    setSending(true);
    try {
      const conversationId = await resolveTargetConversationId();
      if (!conversationId) return;

      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          attachedImage
            ? {
                conversation_id: conversationId,
                message_type: "image",
                media_url: attachedImage.url,
                content_text: trimmed || undefined,
              }
            : {
                conversation_id: conversationId,
                message_type: "text",
                content_text: trimmed,
              },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("sendError"));
        return;
      }
      toast.success(t("sendSuccess"));
      setAttachedImage(null);
      if (!activeConversationId) onOpenConversation(conversationId);
      onOpenChange(false);
    } catch {
      toast.error(t("sendError"));
    } finally {
      setSending(false);
    }
  }, [
    selected,
    message,
    attachedImage,
    sending,
    activeConversationId,
    resolveTargetConversationId,
    onOpenConversation,
    onOpenChange,
    t,
  ]);

  const handleOpenConversation = useCallback(async () => {
    if (!selected?.mobile || opening) return;
    setOpening(true);
    try {
      const res = await fetch("/api/orders/resolve-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: selected.mobile, name: selected.personName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("openError"));
        return;
      }
      onOpenConversation(data.conversation_id);
      onOpenChange(false);
    } catch {
      toast.error(t("openError"));
    } finally {
      setOpening(false);
    }
  }, [selected, opening, onOpenConversation, onOpenChange, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            placeholder={t("placeholder")}
            className="pl-9"
          />
        </div>

        {!selected ? (
          <ScrollArea className="max-h-80">
            <div className="space-y-1.5 pr-2">
              {searching && (
                <div className="flex items-center justify-center py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
              {!searching && query.trim().length > 0 && query.trim().length < 3 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {t("typeToSearch")}
                </p>
              )}
              {!searching && searched && results.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {t("noResults")}
                </p>
              )}
              {!searching &&
                results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelected(r)}
                    className="w-full rounded-lg border border-border bg-muted/40 p-3 text-left transition-colors hover:bg-muted"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {r.personName || t("unnamed")}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(r.createdOn).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {r.mobile && <span>{r.mobile}</span>}
                      {r.amount && (
                        <Badge variant="outline" className="gap-0.5">
                          <IndianRupee className="h-2.5 w-2.5" />
                          {r.amount}
                        </Badge>
                      )}
                      {r.transactionId && (
                        <Badge variant="outline">{r.transactionId}</Badge>
                      )}
                      {r.utr && r.utr !== r.transactionId && (
                        <Badge variant="outline">{r.utr}</Badge>
                      )}
                      <Badge
                        variant={r.downloaded > 0 ? "secondary" : "outline"}
                        className={cn(!r.downloaded && "text-muted-foreground")}
                      >
                        {r.downloaded > 0
                          ? t("downloaded", { count: r.downloaded })
                          : t("notDownloaded")}
                      </Badge>
                    </div>
                  </button>
                ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">
                  {selected.personName || t("unnamed")}
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {t("back")}
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <dt>{t("mobile")}</dt>
                <dd className="text-foreground">{selected.mobile ?? "—"}</dd>
                <dt>{t("amount")}</dt>
                <dd className="text-foreground">{selected.amount ?? "—"}</dd>
                <dt>{t("paymentId")}</dt>
                <dd className="truncate text-foreground">{selected.transactionId ?? "—"}</dd>
                <dt>{t("utr")}</dt>
                <dd className="truncate text-foreground">{selected.utr ?? "—"}</dd>
                <dt>{t("purchasedOn")}</dt>
                <dd className="text-foreground">
                  {new Date(selected.createdOn).toLocaleString()}
                </dd>
              </dl>
            </div>

            <button
              type="button"
              onClick={applyFoundTemplate}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t("useFoundTemplate")}
            </button>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={t("messagePlaceholder")}
              rows={5}
              className="w-full resize-none rounded-xl border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50"
            />

            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleImageChange}
            />

            {attachedImage ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachedImage.url}
                  alt=""
                  className="h-20 w-20 rounded-lg object-cover"
                />
                <button
                  type="button"
                  onClick={removeAttachedImage}
                  aria-label={t("removeAttachment")}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-background/90 p-0.5 text-muted-foreground shadow hover:bg-background hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={uploadingImage}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {uploadingImage ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5" />
                )}
                {t("attachImage")}
              </button>
            )}

            <div className="flex items-center justify-end gap-2">
              {!activeConversationId && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={opening}
                  className="mr-auto gap-1.5 text-xs text-muted-foreground"
                  onClick={handleOpenConversation}
                >
                  {opening ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ExternalLink className="h-3.5 w-3.5" />
                  )}
                  {t("openConversation")}
                </Button>
              )}
              <Button
                size="sm"
                disabled={(!message.trim() && !attachedImage) || sending || uploadingImage}
                onClick={handleSend}
                className="gap-1.5"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {t("send")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
