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
import {
  Search,
  ChevronDown,
  X,
  MoreVertical,
  Trash2,
  MailOpen,
  Pin,
  PinOff,
} from "lucide-react";
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
import {
  markConversationUnread,
  toggleConversationPinned,
} from "@/lib/inbox/conversations";

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
   *  responder-indicator color (with `assignedAgentMap`). */
  profiles: Profile[];
  /** Conversation id → user id of its persistently assigned agent
   *  (`conversations.assigned_agent_id`). See `src/lib/responder-color.ts`. */
  assignedAgentMap: Map<string, string>;
  /** Opens the shared delete-lead confirmation for this conversation's
   *  contact — the parent owns the dialog since it also needs to clear
   *  activeConversation if the deleted one was open. */
  onRequestDelete: (conversation: Conversation) => void;
  /** Local-state sync after a manual unread mark — same callback the
   *  thread header's "Marcar como não lida" already uses, reused here so
   *  both entry points stay in sync (see message-thread.tsx). */
  onMarkUnread: (conversationId: string) => void;
  /** Local-state sync after a pin toggle. */
  onTogglePinned: (conversationId: string, pinned: boolean) => void;
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
  assignedAgentMap,
  onRequestDelete,
  onMarkUnread,
  onTogglePinned,
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

    // Pinned conversations float to the top, same as WhatsApp — the only
    // visible effect of the swipe/right-click "Fixar" action. Stable sort
    // (Array#sort is guaranteed stable) so relative order within each
    // group is otherwise untouched.
    return [...result].sort(
      (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
    );
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

  // Shared by the swipe-right action and the right-click context menu —
  // same DB call the thread header's "Marcar como não lida" uses.
  const handleMarkUnread = useCallback(
    async (conv: Conversation) => {
      const supabase = createClient();
      await markConversationUnread(supabase, conv.id);
      onMarkUnread(conv.id);
    },
    [onMarkUnread]
  );

  // Shared by the swipe-right action and the right-click context menu.
  const handleTogglePinned = useCallback(
    async (conv: Conversation) => {
      const supabase = createClient();
      const next = !conv.pinned;
      await toggleConversationPinned(supabase, conv.id, next);
      onTogglePinned(conv.id, next);
    },
    [onTogglePinned]
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
                onMarkUnread={handleMarkUnread}
                onTogglePinned={handleTogglePinned}
                t={t}
                responderColor={colorForConversation(
                  conv.id,
                  assignedAgentMap,
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
  onMarkUnread: (conversation: Conversation) => void;
  onTogglePinned: (conversation: Conversation) => void;
  t: ReturnType<typeof useTranslations>;
  responderColor: ResponderColor;
}

// Swipe-reveal panel width (px, iOS Mail-style) — one panel, two actions
// (unread + delete). Left-to-right only: a swipe-left/right-side panel
// (delete-only) was tried and reverted — it fought the original
// left-to-right gesture's feel, so there's only ever one direction now.
const SWIPE_LEFT_WIDTH = 152;
// Rubber-band past SWIPE_LEFT_WIDTH: how far the panel can be pulled
// beyond its resting width, and how much of the extra pull actually
// moves it — the resistance iOS gives you dragging a list row (or a
// scroll view) past its natural limit, instead of a hard stop.
const SWIPE_OVERSHOOT_MAX = 28;
const SWIPE_OVERSHOOT_RATIO = 0.28;
// Minimum finger movement (px) before a touch gesture commits to
// horizontal swipe vs. vertical scroll — matches the "10px before
// committing" rule below.
const SWIPE_AXIS_THRESHOLD = 10;
// A gesture only locks to horizontal once it's this many times more
// horizontal than vertical. Confirmed live on a real iPhone (Safari
// Web Inspector, 2026-08-11): even 1.5x let plain taps and ordinary
// vertical scrolling misfire as a swipe — real touch samples wobble
// diagonally far more than any desktop-simulated TouchEvent ever did.
// 2.5x is a much stronger bias toward "this is a scroll" (the far more
// common gesture in a list), matching how conservative WhatsApp's own
// iOS row swipe is about committing to horizontal.
const SWIPE_AXIS_RATIO = 2.5;
// The gesture only qualifies as "open" if it starts over the avatar
// corner (avatar is 40px + the row's 12px left padding) — confirmed
// with the user (2026-08-11) after the axis-ratio fix alone still let
// a swipe starting anywhere on the row (photo, name, or message
// preview) open the panel. A touch starting further right than this
// never locks to "x", no matter how clean the horizontal drag is.
const SWIPE_START_ZONE_PX = 64;
// Apple's spring/bounce feel via a cubic-bezier approximation (true
// spring physics need CSS `linear()` easing, iOS 16.4+ only): a slight
// overshoot past the resting point before settling, instead of a flat
// ease-out. This — plus the rubber-band above — is what reads as
// "elastic" rather than a mechanical slide.
const SWIPE_SPRING_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const SWIPE_SPRING_MS = 320;

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onRequestDelete,
  onMarkUnread,
  onTogglePinned,
  t,
  responderColor,
}: ConversationItemProps) {
  const tLeads = useTranslations("Leads.deleteDialog");
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t("unknown");
  const initials = displayName.charAt(0).toUpperCase();

  // --- Swipe-to-reveal (mobile/PWA) ---------------------------------
  // `revealed` only changes once per gesture, on touch release — the
  // drag itself writes straight to the DOM via `contentRef.current
  // .style.transform` (see applyTransform), bypassing React/setState so
  // dragging never triggers a re-render.
  //
  // Native `addEventListener`/`{ passive: false }` below, NOT React's
  // touch props — confirmed live on a real iPhone (Mac + Safari Web
  // Inspector, 2026-08-11) that this was the actual root cause of the
  // reported "opens on a plain tap, opens scrolling up AND down, no
  // predictability": React always attaches `onTouchMove` as a passive
  // listener, so `preventDefault()` inside it is a silent no-op — the
  // list's native scroll and this component's own transform were both
  // reacting to the same touch stream with neither ever winning
  // cleanly. `use-drawer-gesture.ts` (the sidebar menu) already used
  // native non-passive listeners for exactly this reason; this mirrors
  // that proven pattern instead of React's touch props.
  const contentRef = useRef<HTMLDivElement>(null);
  // The action panel sits behind `contentRef` and only needs to be
  // visible once the drag has actually confirmed horizontal — flipped
  // to `visible` imperatively the instant the gesture locks to "x" (not
  // on every touchstart/tap, which is what let a plain tap flash it
  // open on real hardware), then handed back to the `revealed`-driven
  // class once the gesture settles.
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState<"left" | null>(null);
  // Mirrors `revealed` into a ref so the native-listener effect below
  // (mounted once, not re-subscribed on every reveal change) always
  // reads the current value without needing it as a dependency.
  const revealedRef = useRef(revealed);
  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);
  const dragRef = useRef({
    active: false,
    axis: null as "x" | "y" | null,
    startX: 0,
    startY: 0,
    baseX: 0,
    x: 0,
    // Whether this gesture started within SWIPE_START_ZONE_PX of the
    // row's left edge (the avatar corner) — computed once at
    // touchstart, since only the starting point matters.
    zoneOk: false,
  });

  const applyTransform = useCallback((x: number, animate: boolean) => {
    const el = contentRef.current;
    if (!el) return;
    // 1:1 with the finger during the drag itself (no transition — see
    // the `false` callers below). On release, Apple's own spring/bounce
    // curve (see SWIPE_SPRING_EASE) — a slight overshoot past the
    // resting point before settling — so the open/close snap reads as
    // an elastic catch rather than a mechanical slide.
    el.style.transition = animate
      ? `transform ${SWIPE_SPRING_MS}ms ${SWIPE_SPRING_EASE}`
      : "none";
    el.style.transform = `translate3d(${x}px,0,0)`;
  }, []);

  // Keep the DOM transform in sync whenever `revealed` changes outside
  // a drag (mount, or an action button closing the panel).
  useEffect(() => {
    applyTransform(revealed === "left" ? SWIPE_LEFT_WIDTH : 0, true);
  }, [revealed, applyTransform]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    function handleTouchStart(e: TouchEvent) {
      const touch = e.touches[0];
      if (!touch) return;
      // Non-null: `el` was already checked above, before this closure
      // was defined; it's a `const` capture, never reassigned.
      const rect = el!.getBoundingClientRect();
      dragRef.current = {
        active: true,
        axis: null,
        startX: touch.clientX,
        startY: touch.clientY,
        baseX: revealedRef.current === "left" ? SWIPE_LEFT_WIDTH : 0,
        x: 0,
        zoneOk: touch.clientX - rect.left <= SWIPE_START_ZONE_PX,
      };
    }

    function handleTouchMove(e: TouchEvent) {
      const drag = dragRef.current;
      if (!drag.active) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - drag.startX;
      const dy = touch.clientY - drag.startY;

      if (drag.axis === null) {
        // Vertical wins on the first sign of doubt — a real touchscreen's
        // first sample or two are noisy, and it's far worse to
        // accidentally eat a scroll than to occasionally need a slightly
        // more deliberate swipe. Any movement that's at least as
        // vertical as it is horizontal locks straight to "y", no ratio
        // needed. Horizontal only wins once it's unambiguous (see
        // SWIPE_AXIS_RATIO — deliberately steep) AND left-to-right AND
        // started over the avatar corner (SWIPE_START_ZONE_PX) — this
        // is the *only* gesture that opens the panel.
        if (Math.abs(dy) >= SWIPE_AXIS_THRESHOLD && Math.abs(dy) >= Math.abs(dx)) {
          drag.axis = "y";
        } else if (
          Math.abs(dx) >= SWIPE_AXIS_THRESHOLD &&
          dx > 0 &&
          drag.zoneOk &&
          Math.abs(dx) > Math.abs(dy) * SWIPE_AXIS_RATIO
        ) {
          drag.axis = "x";
          if (leftPanelRef.current) leftPanelRef.current.style.visibility = "visible";
        } else if (Math.abs(dx) >= SWIPE_AXIS_THRESHOLD) {
          // Horizontal-dominant but disqualified — right-to-left
          // anywhere on the row, or left-to-right starting outside the
          // avatar corner. A dead touch as far as this component is
          // concerned: never becomes a swipe, and (by resolving to "y"
          // here) never blocks the list's native scroll either.
          drag.axis = "y";
        } else {
          return; // not enough signal yet either way
        }
      }
      if (drag.axis === "y") return; // vertical drag, or a disqualified swipe — let the list scroll

      // Safety net, re-checked on every move (not just the first
      // sample): if the gesture drifts and vertical overtakes
      // horizontal mid-swipe — a real finger rarely travels in a
      // perfectly straight line — bail out to scroll instead of
      // fighting the page under it.
      if (Math.abs(dy) > Math.abs(dx)) {
        drag.axis = "y";
        drag.x = 0;
        applyTransform(0, true);
        return;
      }

      // Locked horizontal — this is our gesture now, not the list's.
      // Cancel the browser's own scroll/pan for this touch so the two
      // stop competing (only possible because this listener is native
      // and non-passive; React's touch props can't do this).
      e.preventDefault();

      const raw = drag.baseX + dx;
      // Rubber-band once past the fully-open width, instead of a hard
      // clamp — see SWIPE_OVERSHOOT_MAX/_RATIO.
      const clamped =
        raw <= SWIPE_LEFT_WIDTH
          ? Math.max(0, raw)
          : Math.min(
              SWIPE_LEFT_WIDTH + SWIPE_OVERSHOOT_MAX,
              SWIPE_LEFT_WIDTH + (raw - SWIPE_LEFT_WIDTH) * SWIPE_OVERSHOOT_RATIO
            );
      drag.x = clamped;
      applyTransform(clamped, false);
    }

    function handleTouchEnd() {
      const drag = dragRef.current;
      if (!drag.active) return;
      drag.active = false;
      // Hand visibility back to the `revealed`-driven class now that the
      // gesture is settled — clears the imperative override from
      // touchmove so a future hover/idle state can't stay stuck visible.
      if (leftPanelRef.current) leftPanelRef.current.style.visibility = "";
      if (drag.axis !== "x") return;

      // The overshoot rubber-band means `drag.x` can sit slightly past
      // SWIPE_LEFT_WIDTH — clamp back to the real width before
      // comparing against the halfway-open threshold below.
      const settledX = Math.min(drag.x, SWIPE_LEFT_WIDTH);
      const next = settledX > SWIPE_LEFT_WIDTH / 2 ? "left" : null;
      // Snap explicitly here rather than relying solely on the `revealed`
      // effect above: when a partial drag resolves back to the SAME value
      // it already had (the common case — a swipe that doesn't cross the
      // open threshold resolves to `null`, same as before the gesture),
      // React bails out of the state update as a no-op and that effect
      // never re-fires, leaving the card visually stuck wherever the
      // finger let go instead of snapping back. Calling it directly here
      // makes the snap unconditional; the effect still covers the other
      // paths that close it (tap-to-close, action buttons).
      applyTransform(next === "left" ? SWIPE_LEFT_WIDTH : 0, true);
      setRevealed(next);
    }

    // touchmove is the only listener that ever calls preventDefault, and
    // only once the gesture is confirmed horizontal — so it can't be
    // passive. The rest never block the browser's own handling.
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [applyTransform]);

  const closeSwipe = useCallback(() => setRevealed(null), []);

  const handleClick = useCallback(() => {
    // A tap while a swipe panel is open closes it instead of opening
    // the conversation — same as native iOS list rows.
    if (revealed !== null) {
      closeSwipe();
      return;
    }
    onSelect(conversation);
  }, [onSelect, conversation, revealed, closeSwipe]);

  const handleMarkUnreadAction = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      closeSwipe();
      void onMarkUnread(conversation);
    },
    [conversation, onMarkUnread, closeSwipe]
  );

  const handleTogglePinAction = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      closeSwipe();
      void onTogglePinned(conversation);
    },
    [conversation, onTogglePinned, closeSwipe]
  );

  const handleDeleteAction = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      closeSwipe();
      onRequestDelete(conversation);
    },
    [conversation, onRequestDelete, closeSwipe]
  );

  // --- Desktop right-click context menu -----------------------------
  // Reuses the same DropdownMenu primitive as the "..." button below,
  // just controlled and anchored to the cursor instead of a trigger
  // element (Base UI's Positioner accepts a virtual anchor for this).
  const [ctxMenuOpen, setCtxMenuOpen] = useState(false);
  const ctxAnchorRef = useRef({ x: 0, y: 0 });
  const ctxAnchor = useMemo(
    () => ({
      getBoundingClientRect: () => {
        const { x, y } = ctxAnchorRef.current;
        return {
          x,
          y,
          top: y,
          left: x,
          right: x,
          bottom: y,
          width: 0,
          height: 0,
        };
      },
    }),
    []
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    ctxAnchorRef.current = { x: e.clientX, y: e.clientY };
    setCtxMenuOpen(true);
  }, []);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  return (
    <div className="relative min-w-0 overflow-hidden">
      {/* Swipe reveal (left-to-right only): mark unread + delete.
          `z-10`: the sliding content row below is also a positioned
          element (`relative` + a live `transform`), so per CSS stacking
          rules a later-in-DOM positioned sibling with the same
          (auto/0) z-index paints over an earlier one whenever their
          boxes overlap — which they do for most of the drag, not just
          at rest. Without an explicit z-index here, that made this
          panel stay masked under the content through most of the
          swipe, only clearing right at the very end. */}
      <div
        ref={leftPanelRef}
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 z-10 flex",
          revealed === "left" ? "visible" : "invisible"
        )}
        style={{ width: SWIPE_LEFT_WIDTH }}
      >
        <button
          type="button"
          onClick={handleMarkUnreadAction}
          className="flex flex-1 flex-col items-center justify-center gap-1 bg-primary text-[11px] text-primary-foreground"
        >
          <MailOpen className="h-4 w-4" />
          {t("markUnread")}
        </button>
        <button
          type="button"
          onClick={handleDeleteAction}
          className="flex flex-1 flex-col items-center justify-center gap-1 bg-destructive text-[11px] text-destructive-foreground"
        >
          <Trash2 className="h-4 w-4" />
          {t("delete")}
        </button>
      </div>

      {/* A native <button> can't validly contain the dropdown's own
          interactive elements, so this is a div acting as a button
          (role + tabIndex + keydown) — same reasoning as DealCard's
          delete-lead menu in the Pipeline. Also the swipe surface and
          the right-click context-menu surface. */}
      <div
        ref={contentRef}
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        onContextMenu={handleContextMenu}
        style={{ touchAction: "pan-y" }}
        className={cn(
          "group relative flex w-full min-w-0 items-start gap-3 bg-card px-3 py-3 text-left transition-colors hover:bg-muted/50",
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

        {/* Center: name + preview. min-w-0 is load-bearing — a flex
            item's default min-width is `auto` (its content's intrinsic
            width), so without it `truncate` below never actually kicks
            in and a long preview pushes past its share of the row into
            the time/badge column.

            This wrapper is a flex column itself (not a plain block),
            confirmed load-bearing live via Safari Web Inspector
            (2026-08-11): on real WebKit, `max-width: 100%` on the `<p>`
            below was resolving against an *indefinite* containing
            block — a known WebKit percentage-resolution gap through
            nested `flex: 1 1 0%` ancestors — so the paragraph rendered
            at its full unwrapped content width (~2130px measured on
            device) instead of the row's actual width, with nothing
            left to ellipsize against; the overflow just ran past the
            row and got hard-clipped by a distant ancestor's
            `overflow-hidden`, no "…" ever shown. `align-items: stretch`
            (this container's flex-col default) sizes each child's
            width directly through the flex algorithm instead of a CSS
            percentage, which doesn't hit that gap. */}
        <div className="flex min-w-0 flex-1 flex-col pr-2">
          <span className="flex min-w-0 items-center gap-1">
            {conversation.pinned && (
              <Pin className="h-3 w-3 shrink-0 text-amber-500" />
            )}
            <span className="truncate text-sm font-semibold text-foreground">
              {displayName}
            </span>
          </span>
          <p className="mt-0.5 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-muted-foreground">
            {conversation.last_message_text || t("noMessagesYet")}
          </p>
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

        {/* Right column: time/menu on top, unread badge on the bottom —
            self-stretch matches the center block's height so the two
            rows sit flush with the name and preview lines beside them. */}
        <div className="flex min-w-[50px] shrink-0 flex-col items-end justify-between self-stretch py-0.5">
          <div className="flex items-center gap-0.5">
            <span
              className={cn(
                "text-xs font-normal text-muted-foreground",
                conversation.unread_count > 0 && "font-medium text-primary"
              )}
            >
              {timeAgo}
            </span>
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
          <div className="flex items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
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
      </div>

      {/* Desktop right-click context menu — same three actions as the
          swipe panels, positioned at the cursor via a virtual anchor. */}
      <DropdownMenu open={ctxMenuOpen} onOpenChange={setCtxMenuOpen}>
        <DropdownMenuContent
          anchor={ctxAnchor}
          align="start"
          side="bottom"
          className="border-border bg-popover"
        >
          <DropdownMenuItem onClick={handleMarkUnreadAction}>
            <MailOpen className="h-4 w-4" />
            {t("markUnread")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleTogglePinAction}>
            {conversation.pinned ? (
              <PinOff className="h-4 w-4" />
            ) : (
              <Pin className="h-4 w-4" />
            )}
            {conversation.pinned ? t("unpin") : t("pin")}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={handleDeleteAction}>
            <Trash2 className="h-4 w-4" />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
