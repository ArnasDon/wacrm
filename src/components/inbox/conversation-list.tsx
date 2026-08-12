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
import {
  format,
  isToday,
  isYesterday,
  differenceInCalendarDays,
  type Locale,
} from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useLocale, useTranslations } from "next-intl";
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

/**
 * WhatsApp-style relative timestamp for the conversation list row:
 * exact time today, "Ontem"/"Yesterday" for yesterday, the weekday
 * name for the rest of the current week, and a short date beyond
 * that (matches WhatsApp's own list). Replaces date-fns'
 * `formatDistanceToNow` ("12 minutes", "about 1 hour"), which also
 * never respected the app's locale here — always rendered in English
 * regardless of pt-BR/ko. Pure + exported so it's unit-testable
 * without mounting the component.
 */
export function formatConversationTimestamp(
  date: Date,
  yesterdayLabel: string,
  locale?: Locale,
  now: Date = new Date(),
): string {
  if (isToday(date)) return format(date, "HH:mm", { locale });
  if (isYesterday(date)) return yesterdayLabel;
  // Within the current week (but not today/yesterday): weekday name,
  // e.g. "segunda-feira" — matches WhatsApp's own list.
  if (differenceInCalendarDays(now, date) < 7) {
    return format(date, "EEEE", { locale });
  }
  return format(date, "dd/MM/yyyy", { locale });
}

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
// (unread + delete), revealed on the left. A swipe-left/right-side panel
// (delete-only) was tried and reverted — it fought this gesture's feel,
// so there's only ever one panel. Opens with a left-to-right drag
// starting in the row's left half (SWIPE_START_ZONE_RATIO); once open,
// closes with a right-to-left drag from anywhere on the row (added
// 2026-08-12, matching native iOS) — a right-to-left drag while fully
// closed still does nothing, same as tap-elsewhere/the action buttons.
const SWIPE_LEFT_WIDTH = 152;
// Rubber-band past SWIPE_LEFT_WIDTH — UIScrollView's own resistance
// curve (the constant 0.55 is Apple's), not a linear ratio: resistance
// grows smoothly the further past the limit you pull, asymptotically,
// instead of a fixed-rate slowdown or a hard stop. See `rubberBand`
// below.
const SWIPE_RUBBER_BAND_CONSTANT = 0.55;
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
// The gesture only qualifies as "open" if it starts within the left
// half of the row (a ratio of the row's own measured width, not a
// fixed px value, so it scales the same on any screen size) — widened
// from a tight 64px avatar-only corner after confirming on-device
// (2026-08-11) that the axis-ratio fix alone was reliable enough to
// safely open up the start area (2026-08-12) without reintroducing the
// original "opens on literally any touch" bug. A touch starting past
// this line never locks to "x" for opening, no matter how clean the
// horizontal drag is — it can still *close* an already-open panel,
// which has no start-zone restriction (see qualifiesClose below).
const SWIPE_START_ZONE_RATIO = 0.5;
// A fast flick commits to opening/closing even if the finger let go
// before crossing the halfway point — matches native iOS list-row
// behavior (confirmed with the user, 2026-08-12), where a quick swipe
// doesn't need to travel as far as a slow drag to register. Only the
// release's own velocity triggers this; an ordinary tap-speed drag
// still resolves purely by how far it got.
const SWIPE_FLING_VELOCITY = 500;
// Real spring physics (SwiftUI-style response/dampingRatio), not a
// fixed-duration CSS easing curve — confirmed with the user (2026-08-12)
// that a canned cubic-bezier can't do what was actually asked for: the
// settle animation's speed and shape need to depend on how fast the
// finger was moving at release, which a pre-baked curve/duration
// structurally cannot do (the duration is fixed before the gesture's
// velocity is even known). `response` is roughly the period of one
// oscillation in seconds (lower = snappier); `dampingRatio` 1 = no
// bounce (critically damped), <1 = the slight overshoot iOS list rows
// settle with. See `settleSpring` below — it runs the actual
// mass-spring-damper simulation every frame via requestAnimationFrame.
const SWIPE_SPRING_RESPONSE = 0.32;
const SWIPE_SPRING_DAMPING_RATIO = 0.86;
const SWIPE_SPRING_MASS = 1;
// "Close enough" thresholds (px, px/s) below which the spring simulation
// stops and snaps exactly to the target — without this it would
// oscillate asymptotically forever and never truly settle.
const SWIPE_SPRING_REST_DISPLACEMENT = 0.5;
const SWIPE_SPRING_REST_VELOCITY = 20;

/**
 * Apple's UIScrollView rubber-band curve: smooth, ever-growing
 * resistance past a limit — never a hard stop, never a fixed-rate
 * slowdown. `overshoot` is how far past the limit the raw drag distance
 * would put it; `dimension` sets the curve's scale (how much distance
 * "feels" like a natural pull before resistance dominates). Pure +
 * exported so the curve shape is unit-testable without a DOM.
 */
export function rubberBand(overshoot: number, dimension: number): number {
  return (
    (overshoot * dimension * SWIPE_RUBBER_BAND_CONSTANT) /
    (dimension + SWIPE_RUBBER_BAND_CONSTANT * overshoot)
  );
}

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
  const appLocale = useLocale();
  const dateFnsLocale = getDateFnsLocale(appLocale);
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t("unknown");
  const initials = displayName.charAt(0).toUpperCase();

  // --- Swipe-to-reveal (mobile/PWA) ---------------------------------
  // `revealed` only changes once per gesture, on touch release — the
  // drag itself writes straight to the DOM via `contentRef.current
  // .style.transform` (see `dragTransform`/`settleSpring` below),
  // bypassing React/setState so dragging never triggers a re-render.
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
    // Whether this gesture started within the row's left half
    // (SWIPE_START_ZONE_RATIO) — computed once at touchstart, since
    // only the starting point matters.
    zoneOk: false,
    // Smoothed velocity (px/s) — an exponential moving average over
    // real elapsed time between touchmove samples, not just the last
    // delta (a single noisy sample right at release would otherwise
    // dominate). Seeds the release spring so a fast flick and a slow
    // drag animate differently, instead of every release looking the
    // same. Sign follows screen coordinates: positive = rightward.
    velocity: 0,
    lastMoveX: 0,
    lastMoveT: 0,
  });

  // Live, always-current transform value — updated every frame by both
  // the drag itself and the settle spring below. Lets a new touch
  // interrupt an in-flight spring and continue from wherever it
  // actually is on screen (currentXRef), rather than jumping to
  // `revealed`'s theoretical resting value.
  const currentXRef = useRef(0);
  const springFrameRef = useRef<number | null>(null);

  const cancelSpring = useCallback(() => {
    if (springFrameRef.current !== null) {
      cancelAnimationFrame(springFrameRef.current);
      springFrameRef.current = null;
    }
  }, []);

  // Writes straight to the DOM with no CSS transition — used during an
  // active drag, 1:1 with the finger every frame.
  const dragTransform = useCallback(
    (x: number) => {
      const el = contentRef.current;
      if (!el) return;
      cancelSpring();
      el.style.transition = "none";
      el.style.transform = `translate3d(${x}px,0,0)`;
      currentXRef.current = x;
    },
    [cancelSpring],
  );

  // Drives the panel to `target` via a real mass-spring-damper
  // simulation stepped every requestAnimationFrame, seeded with
  // `initialVelocity` (px/s) — NOT a fixed-duration CSS transition. A
  // fast release reaches the target quicker (and can overshoot/settle
  // back, per SWIPE_SPRING_DAMPING_RATIO) than a slow one, because the
  // physics — not a pre-baked curve — determine the motion frame by
  // frame. Interruptible: calling this again (e.g. a new touch grabs
  // the row mid-bounce) cancels the running loop first.
  const settleSpring = useCallback(
    (target: number, initialVelocity: number) => {
      const el = contentRef.current;
      if (!el) return;
      cancelSpring();
      el.style.transition = "none";

      let pos = currentXRef.current;
      let vel = initialVelocity;
      let lastTime: number | null = null;

      // response/dampingRatio (SwiftUI-style) → stiffness/damping for
      // the underlying F = -stiffness·x - damping·v equation.
      const angularFreq = (2 * Math.PI) / SWIPE_SPRING_RESPONSE;
      const stiffness = angularFreq * angularFreq * SWIPE_SPRING_MASS;
      const damping = 2 * SWIPE_SPRING_DAMPING_RATIO * angularFreq * SWIPE_SPRING_MASS;

      function frame(time: number) {
        if (lastTime === null) lastTime = time;
        // Clamp dt so a dropped/backgrounded frame (tab switch, a slow
        // frame) can't make the spring jump wildly on the next tick.
        const dt = Math.min((time - lastTime) / 1000, 1 / 30);
        lastTime = time;

        const displacement = pos - target;
        const accel = (-stiffness * displacement - damping * vel) / SWIPE_SPRING_MASS;
        vel += accel * dt;
        pos += vel * dt;

        const settled =
          Math.abs(pos - target) < SWIPE_SPRING_REST_DISPLACEMENT &&
          Math.abs(vel) < SWIPE_SPRING_REST_VELOCITY;

        if (settled) {
          currentXRef.current = target;
          el!.style.transform = `translate3d(${target}px,0,0)`;
          springFrameRef.current = null;
          return;
        }

        currentXRef.current = pos;
        el!.style.transform = `translate3d(${pos}px,0,0)`;
        springFrameRef.current = requestAnimationFrame(frame);
      }

      springFrameRef.current = requestAnimationFrame(frame);
    },
    [cancelSpring],
  );

  // Keep the DOM transform in sync whenever `revealed` changes outside
  // a drag (mount, or an action button closing the panel) — velocity 0,
  // these aren't gesture releases.
  useEffect(() => {
    settleSpring(revealed === "left" ? SWIPE_LEFT_WIDTH : 0, 0);
  }, [revealed, settleSpring]);

  // Belt-and-suspenders: cancel any running spring loop on unmount so
  // it never writes to a detached node.
  useEffect(() => cancelSpring, [cancelSpring]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    function handleTouchStart(e: TouchEvent) {
      const touch = e.touches[0];
      if (!touch) return;
      // Non-null: `el` was already checked above, before this closure
      // was defined; it's a `const` capture, never reassigned.
      const rect = el!.getBoundingClientRect();
      // Grabbing the row while it's mid-bounce from a previous gesture
      // continues from wherever it actually is (currentXRef), not a
      // jump to the settled 0/SWIPE_LEFT_WIDTH value.
      cancelSpring();
      dragRef.current = {
        active: true,
        axis: null,
        startX: touch.clientX,
        startY: touch.clientY,
        baseX: currentXRef.current,
        x: 0,
        zoneOk: touch.clientX - rect.left <= rect.width * SWIPE_START_ZONE_RATIO,
        velocity: 0,
        lastMoveX: touch.clientX,
        lastMoveT: e.timeStamp,
      };
    }

    function handleTouchMove(e: TouchEvent) {
      const drag = dragRef.current;
      if (!drag.active) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - drag.startX;
      const dy = touch.clientY - drag.startY;

      // Smoothed velocity (px/s), tracked on every sample regardless of
      // axis — an exponential moving average so a single noisy sample
      // right before release doesn't dominate the value fed to the
      // settle spring.
      const dt = e.timeStamp - drag.lastMoveT;
      if (dt > 0) {
        const instVelocity = ((touch.clientX - drag.lastMoveX) / dt) * 1000;
        drag.velocity = drag.velocity * 0.7 + instVelocity * 0.3;
      }
      drag.lastMoveX = touch.clientX;
      drag.lastMoveT = e.timeStamp;

      if (drag.axis === null) {
        // Vertical wins on the first sign of doubt — a real touchscreen's
        // first sample or two are noisy, and it's far worse to
        // accidentally eat a scroll than to occasionally need a slightly
        // more deliberate swipe. Any movement that's at least as
        // vertical as it is horizontal locks straight to "y", no ratio
        // needed. Horizontal only wins once it's unambiguous (see
        // SWIPE_AXIS_RATIO — deliberately steep) AND is one of the two
        // gestures this component actually recognizes: left-to-right
        // starting over the avatar corner (opens, closed → open) OR
        // right-to-left with the panel already at least partly open
        // (closes, from anywhere on the row — matches native iOS,
        // confirmed with the user 2026-08-12). A right-to-left drag
        // while fully closed still does nothing, same as before.
        const qualifiesOpen = dx > 0 && drag.zoneOk;
        const qualifiesClose = dx < 0 && drag.baseX > 0;
        if (Math.abs(dy) >= SWIPE_AXIS_THRESHOLD && Math.abs(dy) >= Math.abs(dx)) {
          drag.axis = "y";
        } else if (
          Math.abs(dx) >= SWIPE_AXIS_THRESHOLD &&
          (qualifiesOpen || qualifiesClose) &&
          Math.abs(dx) > Math.abs(dy) * SWIPE_AXIS_RATIO
        ) {
          drag.axis = "x";
          if (leftPanelRef.current) leftPanelRef.current.style.visibility = "visible";
        } else if (Math.abs(dx) >= SWIPE_AXIS_THRESHOLD) {
          // Horizontal-dominant but disqualified — left-to-right
          // starting outside the avatar corner, or right-to-left with
          // nothing open to close. A dead touch as far as this
          // component is concerned: never becomes a swipe, and (by
          // resolving to "y" here) never blocks the list's native
          // scroll either.
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
      // fighting the page under it. Settles to whichever side (open/
      // closed) is nearer from wherever it currently is, same rule as
      // a normal release — NOT always back to closed: that was fine
      // when the only possible gesture was opening from closed, but
      // now a close-in-progress that drifts vertical needs to resolve
      // the same way, or the row could end up visually closed while
      // `revealed` internally still thinks it's open (breaking the
      // next tap's close-vs-navigate decision in handleClick).
      if (Math.abs(dy) > Math.abs(dx)) {
        drag.axis = "y";
        const settledX = Math.min(Math.max(drag.x, 0), SWIPE_LEFT_WIDTH);
        const next = settledX > SWIPE_LEFT_WIDTH / 2 ? "left" : null;
        settleSpring(next === "left" ? SWIPE_LEFT_WIDTH : 0, drag.velocity);
        setRevealed(next);
        return;
      }

      // Locked horizontal — this is our gesture now, not the list's.
      // Cancel the browser's own scroll/pan for this touch so the two
      // stop competing (only possible because this listener is native
      // and non-passive; React's touch props can't do this).
      e.preventDefault();

      const raw = drag.baseX + dx;
      // Rubber-band past either end — Apple's own resistance curve, see
      // `rubberBand` above — instead of a hard clamp: past the fully-open
      // width when opening/over-pulling, and symmetrically past fully
      // closed when a close gesture is dragged further left than needed
      // (the little give a native iOS row has at both extremes).
      const clamped =
        raw < 0
          ? -rubberBand(-raw, SWIPE_LEFT_WIDTH)
          : raw <= SWIPE_LEFT_WIDTH
            ? raw
            : SWIPE_LEFT_WIDTH + rubberBand(raw - SWIPE_LEFT_WIDTH, SWIPE_LEFT_WIDTH);
      drag.x = clamped;
      dragTransform(clamped);
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

      // The rubber-band means `drag.x` can sit past either end — clamp
      // back to [0, SWIPE_LEFT_WIDTH] before deciding.
      const settledX = Math.min(Math.max(drag.x, 0), SWIPE_LEFT_WIDTH);
      let next: "left" | null;
      if (drag.velocity <= -SWIPE_FLING_VELOCITY) {
        // Fast flick left — close regardless of how far it actually
        // got, same as a native iOS list row.
        next = null;
      } else if (drag.velocity >= SWIPE_FLING_VELOCITY) {
        next = "left";
      } else {
        next = settledX > SWIPE_LEFT_WIDTH / 2 ? "left" : null;
      }
      // The real gesture velocity feeds the spring — a fast flick
      // snaps to the target quicker (and can bounce, per
      // SWIPE_SPRING_DAMPING_RATIO) than a slow release. Called
      // directly here (not left to the `revealed` effect above) so a
      // release that resolves back to the SAME value it already had —
      // the common case, a swipe that doesn't cross the open threshold
      // — still animates: `setRevealed` would be a no-op state update
      // in that case and the effect wouldn't re-fire.
      settleSpring(next === "left" ? SWIPE_LEFT_WIDTH : 0, drag.velocity);
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
  }, [dragTransform, settleSpring, cancelSpring]);

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
  }, [setCtxMenuOpen]);

  const timeAgo = conversation.last_message_at
    ? formatConversationTimestamp(
        new Date(conversation.last_message_at),
        t("yesterday"),
        dateFnsLocale,
      )
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
