"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  loadUnansweredConversationIds,
  matchesContactFilters,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import { cn } from "@/lib/utils";
import {
  RESPONDER_COLOR_CLASS,
  colorForConversation,
  type ResponderColor,
} from "@/lib/responder-color";
import type { Conversation, ConversationStatus, Profile, Tag } from "@/types";
import { Search, ChevronDown, X, MoreVertical, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
  /**
   * Applied as the initial filter — the dashboard's "Leads Não
   * Respondidos" card drill-through (`/inbox?filter=unanswered`).
   * Read once on mount, same as any other `useState` initializer; the
   * user can still change the filter afterwards via the dropdown.
   */
  initialFilter?: InboxFilter;
  /** Team profiles — builds the "Atendente" filter and resolves the
   *  responder-indicator color (with `lastAgentSenderMap`). */
  profiles: Profile[];
  /** Conversation id → user id of whoever last sent an internal (agent)
   *  message on it. See `src/lib/responder-color.ts`. */
  lastAgentSenderMap: Map<string, string>;
  /** Opens the shared delete-lead confirmation for this conversation's
   *  contact — the parent owns the dialog since it also needs to clear
   *  activeConversation if the deleted one was open. */
  onRequestDelete: (conversation: Conversation) => void;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};



type InboxFilter = ConversationStatus | "all" | "unread" | "unanswered";

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
  initialFilter,
  profiles,
  lastAgentSenderMap,
  onRequestDelete,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");

  const [search, setSearch] = useState("");
  // The dropdown that used to set this manually is gone from this screen
  // (WACRM inbox redesign task) — `filter` is now seeded once from the
  // dashboard's `?filter=unanswered` deep link (`initialFilter`) and
  // still drives `filtered` below; nothing on this screen calls a setter
  // for it anymore.
  const [filter] = useState<InboxFilter>(initialFilter ?? "all");
  const [loading, setLoading] = useState(true);
  // Ids currently matching the "unanswered" rule (same RPC the
  // dashboard's "Leads Não Respondidos" count uses — see
  // loadUnansweredConversationIds). Only fetched while that filter is
  // selected, and re-fetched whenever any conversation's last message
  // or status changes (unansweredSignature below) so replying to a
  // lead promptly drops it out of the filtered list.
  const [unansweredIds, setUnansweredIds] = useState<Set<string>>(new Set());
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // WhatsApp-style "Todas / Não lidas" toggle, kept independent of the
  // Status dropdown above (open/pending/closed/unanswered) — the two
  // combine via AND like every other filter here, not a replacement for
  // it. "all" is a no-op; "unread" mirrors the Status dropdown's own
  // "unread" option so either control gets you there.
  const [readFilter, setReadFilter] = useState<"all" | "unread">("all");
  // "Atendente" — filters by the lead's assigned responsible
  // (`assigned_agent_id`), NOT by who last replied (that's the
  // indicator bar's job, a different concept — see AGENTS task).
  // "all" is a no-op; otherwise a `profiles.user_id`.
  const [attendantFilter, setAttendantFilter] = useState<string>("all");

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Changes whenever any conversation's last message or status changes —
  // both are exactly what can flip a conversation in or out of the
  // "unanswered" rule, so this is the signal to refetch that set.
  const unansweredSignature = useMemo(
    () =>
      conversations
        .map((c) => `${c.id}:${c.last_message_at ?? ""}:${c.status}`)
        .join("|"),
    [conversations],
  );

  useEffect(() => {
    if (filter !== "unanswered") return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const ids = await loadUnansweredConversationIds(supabase);
        if (!cancelled) setUnansweredIds(ids);
      } catch (error) {
        console.error("Failed to load unanswered conversations:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, unansweredSignature]);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter === "unanswered") {
      result = result.filter((c) => unansweredIds.has(c.id));
    } else if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
    }

    if (readFilter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    }

    if (attendantFilter !== "all") {
      result = result.filter((c) => c.assigned_agent_id === attendantFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [
    conversations,
    filter,
    search,
    selectedTagIds,
    selectedCompany,
    unansweredIds,
    readFilter,
    attendantFilter,
  ]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const hasContactFilters = selectedTagIds.length > 0 || selectedCompany !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t("searchPlaceholder")}
            className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
          />
        </div>

        {/* WhatsApp-style "Todas / Não lidas" toggle + Atendente filter,
            pushed apart so Atendente lands at the right edge. Wraps
            under itself on narrow widths via flex-wrap, same as the row
            below. */}
        <div className="flex flex-wrap items-center justify-between gap-1">
          <div className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5">
            <button
              onClick={() => setReadFilter("all")}
              className={cn(
                "h-6 rounded px-2 text-xs transition-colors",
                readFilter === "all"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("filterAll")}
            </button>
            <button
              onClick={() => setReadFilter("unread")}
              className={cn(
                "h-6 rounded px-2 text-xs transition-colors",
                readFilter === "unread"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("filterUnread")}
            </button>
          </div>

          {profiles.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-40 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  attendantFilter !== "all"
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">
                  {attendantFilter === "all"
                    ? t("allAttendants")
                    : profiles.find((p) => p.user_id === attendantFilter)
                        ?.full_name ?? t("allAttendants")}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setAttendantFilter("all")}
                  className={cn(
                    "text-sm",
                    attendantFilter === "all"
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {t("allAttendants")}
                </DropdownMenuItem>
                {profiles.map((p) => (
                  <DropdownMenuItem
                    key={p.user_id}
                    onClick={() => setAttendantFilter(p.user_id)}
                    className={cn(
                      "text-sm",
                      attendantFilter === p.user_id
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <span className="truncate">{p.full_name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* The "Todas ▼" status filter and "Tags ▼" dropdown that used to
            sit here were removed from THIS screen only (WACRM inbox
            redesign task) — Tags themselves, the `tags`/`selectedTagIds`
            state, and `matchesContactFilters` are all untouched and still
            drive filtering elsewhere (Broadcasts audience, this list's own
            `filtered` useMemo if `selectedTagIds` is ever set again, e.g.
            from a future entry point). `filter` (status/unread/unanswered)
            is also still live — it's still seeded by the dashboard's
            `?filter=unanswered` deep link even with its own dropdown gone. */}
        <div className="flex flex-wrap items-center gap-1">
          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-40 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedCompany
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{selectedCompany ?? t("company")}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    "text-sm",
                    selectedCompany === null
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {t("allCompanies")}
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      "text-sm",
                      selectedCompany === co
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag?.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="max-w-24 truncate">{tag?.name ?? t("tags")}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("clearAll")}
            </button>
          </div>
        )}
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("noConversations")}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                onRequestDelete={onRequestDelete}
                t={t}
                responderColor={colorForConversation(
                  conv.id,
                  lastAgentSenderMap,
                  profiles
                )}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  onRequestDelete: (conversation: Conversation) => void;
  t: ReturnType<typeof useTranslations>;
  responderColor: ResponderColor;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onRequestDelete,
  t,
  responderColor,
}: ConversationItemProps) {
  const tLeads = useTranslations("Leads.deleteDialog");
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t("unknown");
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  return (
    // A native <button> can't validly contain the dropdown's own
    // interactive elements, so this is a div acting as a button
    // (role + tabIndex + keydown) — same reasoning as DealCard's
    // delete-lead menu in the Pipeline.
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      className={cn(
        "group relative flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50",
        isActive && "border-l-2 border-primary bg-muted/70"
      )}
    >
      {/* Avatar */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
        {contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {displayName}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground">{timeAgo}</span>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-5 w-5 text-muted-foreground"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={tLeads("menuLabel")}
                  />
                }
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-border bg-popover">
                <DropdownMenuItem
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestDelete(conversation);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  {tLeads("menuLabel")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {conversation.last_message_text || t("noMessagesYet")}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            {conversation.status !== "open" && (
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  STATUS_COLORS[conversation.status]
                )}
                title={conversation.status}
              />
            )}
          </div>
        </div>
        {/* Last-internal-responder indicator — no text/icon, color only
            (blue = Ronaldo, pink = Tatiana, gray = no internal reply
            yet). Same source as the Pipeline's DealCard bar. */}
        <span
          aria-hidden
          className={cn(
            "mt-1.5 block h-1 w-8 rounded-full",
            RESPONDER_COLOR_CLASS[responderColor]
          )}
        />
      </div>
    </div>
  );
}
