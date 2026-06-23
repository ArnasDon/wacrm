"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import {
  Search,
  Inbox,
  Mail,
  MessageCircle,
  Clock,
  CircleCheck,
  User,
  type LucideIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

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
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};

// Stable empty array so conversations without tags don't get a fresh
// reference each render (which would needlessly re-render the item).
const EMPTY_TAGS: Tag[] = [];

type InboxFilter = ConversationStatus | "all" | "unread";

const FILTER_OPTIONS: { label: string; value: InboxFilter; icon: LucideIcon }[] = [
  { label: "All", value: "all", icon: Inbox },
  { label: "Unread", value: "unread", icon: Mail },
  { label: "Open", value: "open", icon: MessageCircle },
  { label: "Pending", value: "pending", icon: Clock },
  { label: "Closed", value: "closed", icon: CircleCheck },
];

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [loading, setLoading] = useState(true);
  // Maps to decorate each list item without coupling to the conversations
  // array (which the parent rewrites on realtime events). Keyed so we can
  // look up by the conversation's assigned_agent_id / contact_id.
  const [agentNames, setAgentNames] = useState<Map<string, string>>(new Map());
  const [tagsByContact, setTagsByContact] = useState<Map<string, Tag[]>>(
    new Map()
  );

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
      // Conversations drive the list; profiles resolve the assigned agent's
      // name and contact_tags decorate each row with the contact's tags.
      // Tags/agents are kept in their own maps (not merged into the
      // conversation objects) so the parent's realtime rewrites don't drop them.
      const [convRes, profRes, tagRes] = await Promise.all([
        supabase
          .from("conversations")
          .select("*, contact:contacts(*)")
          .order("last_message_at", { ascending: false }),
        supabase.from("profiles").select("user_id, full_name"),
        supabase.from("contact_tags").select("contact_id, tag:tags(*)"),
      ]);

      if (cancelled) return;

      if (convRes.error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: convRes.error.message,
          details: convRes.error.details,
          hint: convRes.error.hint,
          code: convRes.error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(convRes.data ?? []);

      if (profRes.data) {
        setAgentNames(
          new Map(
            profRes.data
              .filter((p) => p.user_id && p.full_name)
              .map((p) => [p.user_id as string, p.full_name as string])
          )
        );
      }

      if (tagRes.data) {
        // `tag` is a to-one relation so it resolves to a single row at
        // runtime, though supabase-js types it as an array — normalize both.
        const map = new Map<string, Tag[]>();
        for (const row of tagRes.data as unknown as {
          contact_id: string;
          tag: Tag | Tag[] | null;
        }[]) {
          const tag = Array.isArray(row.tag) ? row.tag[0] : row.tag;
          if (!tag) continue;
          const arr = map.get(row.contact_id);
          if (arr) arr.push(tag);
          else map.set(row.contact_id, [tag]);
        }
        setTagsByContact(map);
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
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
  }, [conversations, filter, search]);

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
            placeholder="Search conversations..."
            className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
          />
        </div>

        <TooltipProvider>
          <div className="flex items-center gap-1">
            {FILTER_OPTIONS.map((opt) => {
              const isActive = filter === opt.value;
              return (
                <Tooltip key={opt.value}>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-sm"
                        variant={isActive ? "secondary" : "ghost"}
                        onClick={() => setFilter(opt.value)}
                        aria-label={opt.label}
                        aria-pressed={isActive}
                        className={cn(
                          !isActive && "text-muted-foreground"
                        )}
                      />
                    }
                  >
                    <opt.icon className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent>{opt.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
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
            <p className="text-sm text-muted-foreground">No conversations found</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                assigneeName={
                  conv.assigned_agent_id
                    ? agentNames.get(conv.assigned_agent_id)
                    : undefined
                }
                tags={tagsByContact.get(conv.contact_id) ?? EMPTY_TAGS}
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
  /** Full name of the agent the conversation is assigned to, if any. */
  assigneeName?: string;
  /** Tags linked to the conversation's contact. */
  tags: Tag[];
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  assigneeName,
  tags,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || "Unknown";
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
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50",
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
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {conversation.last_message_text || "No messages yet"}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>

        {/* Assigned agent + contact tags. Agent comes first so it's
            always the leading chip, then the contact's tags wrap below. */}
        {(assigneeName || tags.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {assigneeName && (
              <span className="inline-flex max-w-full items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-inset ring-border">
                <User className="size-2.5 shrink-0" />
                <span className="truncate">{assigneeName}</span>
              </span>
            )}
            {tags.map((tag) => (
              <span
                key={tag.id}
                className="max-w-full truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: `${tag.color}20`,
                  color: tag.color,
                }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
