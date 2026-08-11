"use client";

import { Suspense, useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from "@/lib/inbox/conversations";
import type { Conversation, Message, Contact, ConversationStatus, Profile } from "@/types";
import { fetchLastAgentSenderMap } from "@/lib/responder-color";
import { useRealtime } from "@/hooks/use-realtime";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import { ContactSidebar } from "@/components/inbox/contact-sidebar";
import { toast } from "sonner";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

// Remembers the agent's show/hide choice for the desktop contact panel
// across reloads and sessions (device-scoped, like the theme prefs).
const CONTACT_PANEL_STORAGE_KEY = "wacrm:inbox:contact-panel-open";

// `useSearchParams` (the `?c=<id>` deep link below) requires a Suspense
// boundary or the production build bails to CSR and errors out. Thin
// wrapper supplies it; the inner component holds all the inbox state.
export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxPageInner />
    </Suspense>
  );
}

function InboxPageInner() {
  const t = useTranslations("Inbox.page");
  const router = useRouter();
  const searchParams = useSearchParams();
  /**
   * `?c=<id>` deep-link support. Used when landing here from the
   * dashboard's recent-conversations list so the right thread opens
   * automatically instead of showing the empty center panel.
   */
  const deepLinkConvId = searchParams.get("c");
  /**
   * `?filter=unanswered` drill-through from the dashboard's "Leads Não
   * Respondidos" card. Only "unanswered" is recognized here — anything
   * else falls back to ConversationList's own default ("all") rather
   * than passing through an arbitrary/invalid value.
   */
  const initialInboxFilter =
    searchParams.get("filter") === "unanswered" ? "unanswered" : undefined;

  // iOS's native "scroll the focused input into view" behavior, on
  // focusing the composer's textarea, can scroll `<main>` (dashboard-
  // shell.tsx — always `overflow-y-auto`, needed there for pages taller
  // than the viewport) even though this panel's own height already
  // exactly matches `<main>`'s (see the height comment below) and
  // never legitimately needs `<main>` to scroll. That scroll pushes
  // everything up out of view — conversation header included — which
  // is what was reported as the header/composer "flying up" when the
  // keyboard opens (2026-08-07, parte 28). Rather than reacting to that
  // scroll after the fact (tried and reverted before, partes 17-18:
  // fighting a scroll after it happens is unreliable and can itself
  // misbehave), this prevents it outright: `<main>` is genuinely not
  // scrollable while a conversation is open, so there's nothing for
  // iOS to scroll to begin with. Scoped to this page only — `<main>`
  // reverts to its normal scrollable behavior the moment this
  // unmounts, unaffected on every other route (Dashboard, Settings,
  // etc., which do need it for taller content).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const main = rootRef.current?.closest("main");
    if (!main) return;
    const previousOverflow = main.style.overflowY;
    main.style.overflowY = "hidden";
    return () => {
      main.style.overflowY = previousOverflow;
    };
  }, []);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(
    null
  );
  /**
   * Bumped whenever we want children (ConversationList, MessageThread)
   * to refetch from the DB — used as a safety net against missed
   * realtime events. Bumped on WS reconnect and on tab visibility →
   * visible. The initial mount fetches don't depend on this; they fire
   * once on conversationId-change as usual.
   */
  const [resyncToken, setResyncToken] = useState(0);

  /**
   * Team profiles (for the Inbox "Atendente" filter and to resolve the
   * responder-indicator color) and, for every conversation, the user id
   * of whoever last sent an internal (agent) message on it. Both are
   * account-scoped by RLS. The map is seeded from a single aggregate
   * query (`list_conversation_last_agent_senders`, migration 054 — no
   * per-card query) and kept live by the same message-INSERT realtime
   * events that already patch `last_message_text` below, plus an
   * optimistic patch on send (handleNewMessage) for instant feedback.
   */
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [lastAgentSenderMap, setLastAgentSenderMap] = useState<
    Map<string, string>
  >(new Map());

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("profiles").select("*");
      if (!cancelled && data) setProfiles(data as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      try {
        const map = await fetchLastAgentSenderMap(supabase);
        if (!cancelled) setLastAgentSenderMap(map);
      } catch (error) {
        console.error("Failed to load last agent senders:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resyncToken]);

  /**
   * Whether the desktop contact sidebar (tags / deals / notes) is shown.
   * Defaults to `false` (collapsed) and is restored from localStorage
   * after mount. We deliberately do NOT read localStorage in the
   * initializer: the server renders with `false`, so reading a stored
   * `true` synchronously would produce a hydration mismatch. The effect
   * below reconciles to the stored value right after mount instead — so
   * a returning agent who had it open still gets it back, just not on
   * the very first paint.
   */
  const [contactPanelOpen, setContactPanelOpen] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONTACT_PANEL_STORAGE_KEY);
      if (stored !== null) setContactPanelOpen(stored === "true");
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
  }, []);

  const handleToggleContactPanel = useCallback(() => {
    setContactPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CONTACT_PANEL_STORAGE_KEY, String(next));
      } catch {
        // Persistence is best-effort; ignore storage failures.
      }
      return next;
    });
  }, []);

  // Fire the deep-link auto-select exactly once per URL — subsequent
  // list refreshes (realtime, manual refetch) must not snap the user
  // back to the deep-linked conversation if they've already clicked
  // elsewhere.
  const autoSelectedForDeepLinkRef = useRef<string | null>(null);

  // Tracks conversations whose hydrate fetch is currently in flight. The
  // conv-INSERT and the first-message-INSERT events both call into
  // hydrateConversation; the dedupe here keeps it at one refetch per
  // new conversation even when both events arrive within milliseconds.
  const hydratingConvIdsRef = useRef<Set<string>>(new Set());

  /**
   * Synchronous mirror of the conversation ids currently in `conversations`
   * state. Event handlers need to know "do we already have this conv?"
   * without waiting for a setState updater to run — updaters fire during
   * reconciliation, *after* the synchronous handler code returns, so a
   * `let foundInList = false; setState(p => { foundInList = ...; return ... })`
   * flag reads as `false` in the same tick (this exact bug shipped in #105
   * and caused #106: every incoming message and every status flip fired a
   * redundant DB hydrate, swamping the supabase client and starving the
   * realtime channel). The ref is kept in sync via the effect below.
   */
  const knownConvIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set<string>();
    for (const c of conversations) next.add(c.id);
    knownConvIdsRef.current = next;
  }, [conversations]);

  // Pull the conversation row with its `contact` joined and merge it
  // into state. Needed because Supabase Realtime payloads only carry the
  // row's own columns — a brand-new conversation arrives without a
  // contact, which surfaced as "Unknown" names, empty avatars, and
  // (when the conv-INSERT event was delayed past the message-INSERT)
  // conversations stuck on "No messages yet" until the user reloaded.
  // Also self-heals if a realtime event was missed: callers can invoke
  // this whenever they reference a conversation id they don't recognise.
  const hydrateConversation = useCallback(async (convId: string) => {
    if (hydratingConvIdsRef.current.has(convId)) return;
    hydratingConvIdsRef.current.add(convId);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .eq("id", convId)
        .maybeSingle();
      if (error) {
        // Supabase errors have non-enumerable properties — log fields
        // explicitly so the console message isn't just `{}`.
        console.error("Failed to hydrate conversation:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return;
      }
      if (!data) return;
      const fetched = normalizeConversation(data);
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === fetched.id);
        if (existing) {
          // Already in state — keep its fields (a realtime UPDATE may
          // have landed while the fetch was in flight and patched
          // last_message_text / unread_count to fresher values than
          // the row we just read). Only backfill `contact`, which the
          // realtime payloads never carry.
          return prev.map((c) =>
            c.id === fetched.id
              ? { ...c, contact: c.contact ?? fetched.contact }
              : c,
          );
        }
        return [fetched, ...prev];
      });
    } finally {
      hydratingConvIdsRef.current.delete(convId);
    }
  }, []);

  // Check WhatsApp connection status on mount
  useEffect(() => {
    const checkConnection = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) return;

      // whatsapp_config is one-row-per-account post-multi-user, so
      // the previous `.eq('user_id', user.id)` would miss the row
      // for any teammate who didn't personally save the config —
      // the "WhatsApp not connected" banner would show in the
      // shared inbox even though the admin had it configured.
      // Resolve account_id via the profile and query by that.
      const { data: profile } = await supabase
        .from("profiles")
        .select("account_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const accountId = profile?.account_id as string | undefined;
      if (!accountId) {
        setWhatsappConnected(false);
        return;
      }

      const { data } = await supabase
        .from("whatsapp_config")
        .select("status")
        .eq("account_id", accountId)
        .maybeSingle();

      setWhatsappConnected(data?.status === "connected");
    };

    checkConnection();
  }, []);

  // Handle realtime message events
  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message; old: Partial<Message> }) => {
      const newMsg = event.new;

      if (event.eventType === "INSERT") {
        // Keep the "last internal responder" map live — only an agent
        // message with an attributed sender can change a conversation's
        // color (customer messages and unattributed sends never do).
        if (newMsg.sender_type === "agent" && newMsg.sender_id) {
          const senderId = newMsg.sender_id;
          setLastAgentSenderMap((prev) => {
            const next = new Map(prev);
            next.set(newMsg.conversation_id, senderId);
            return next;
          });
        }

        // Add to messages if it belongs to active conversation
        if (
          activeConversation &&
          newMsg.conversation_id === activeConversation.id
        ) {
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            // Replace optimistic message if it exists
            const withoutOptimistic = prev.filter(
              (m) => !m.id.startsWith("temp-")
            );
            return [...withoutOptimistic, newMsg];
          });
        }

        // Update conversation list preview. We need to know *synchronously*
        // whether the conv is already in state to decide between patching
        // the preview and triggering a hydrate — see the comment on
        // knownConvIdsRef for why a closure flag inside the updater would
        // always read false here.
        if (knownConvIdsRef.current.has(newMsg.conversation_id)) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === newMsg.conversation_id
                ? {
                    ...c,
                    last_message_text: newMsg.content_text ?? "",
                    last_message_at: newMsg.created_at,
                    unread_count:
                      activeConversation?.id === newMsg.conversation_id
                        ? 0
                        : c.unread_count + 1,
                  }
                : c,
            ),
          );
        } else {
          // First time we're seeing this conv: the conv-INSERT event
          // hasn't landed yet, or was missed. Hydrate from the DB so
          // the row surfaces with its `contact` joined; the conv-UPDATE
          // event the webhook emits right after the message INSERT will
          // converge state when it arrives.
          hydrateConversation(newMsg.conversation_id);
        }
      }

      if (event.eventType === "UPDATE") {
        // Update message status
        setMessages((prev) =>
          prev.map((m) => (m.id === newMsg.id ? { ...m, ...newMsg } : m))
        );
      }

      if (event.eventType === "DELETE") {
        // Postgres DELETE payloads only populate `old` — `new` is empty.
        // Covers a message deleted from another tab/agent; the deleting
        // client itself already removed it optimistically.
        const deletedId = event.old?.id;
        if (deletedId) {
          setMessages((prev) => prev.filter((m) => m.id !== deletedId));
        }
      }
    },
    [activeConversation, hydrateConversation]
  );

  // Handle realtime conversation events
  const handleConversationEvent = useCallback(
    (event: {
      eventType: string;
      new: Conversation;
      old: Partial<Conversation>;
    }) => {
      const conv = event.new;

      if (event.eventType === "INSERT") {
        // Prepend immediately for snappy UX so the new conv shows in the
        // list right away, then hydrate to fill in the `contact` join
        // (realtime payloads never include joins). Skip both if we
        // already have the row — that shouldn't happen normally, but
        // out-of-order delivery would have us prepending a duplicate.
        if (!knownConvIdsRef.current.has(conv.id)) {
          setConversations((prev) => {
            if (prev.some((c) => c.id === conv.id)) return prev;
            return [conv, ...prev];
          });
          hydrateConversation(conv.id);
        }
      }

      if (event.eventType === "UPDATE") {
        if (knownConvIdsRef.current.has(conv.id)) {
          // If this UPDATE is for the conv the user is currently viewing,
          // suppress the incoming unread_count — the user is reading it
          // RIGHT NOW, so any positive value would just flicker the badge
          // back on for the ~100ms it takes for the reset effect's server
          // UPDATE to round-trip. Non-active convs take the value as-is.
          const isActive = activeConversation?.id === conv.id;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conv.id
                ? {
                    ...c,
                    ...conv,
                    unread_count: isActive ? 0 : conv.unread_count,
                  }
                : c,
            ),
          );
        } else {
          // UPDATE arrived before the INSERT (or after a missed INSERT)
          // — fetch the row so it surfaces with its contact joined. The
          // patch contained in `conv` will already be reflected in what
          // the hydrate fetch returns.
          hydrateConversation(conv.id);
        }

        // Update active conversation if it changed
        if (activeConversation && conv.id === activeConversation.id) {
          setActiveConversation((prev) =>
            prev ? { ...prev, ...conv } : prev
          );
        }
      }
    },
    [activeConversation, hydrateConversation]
  );

  // Subscribe to realtime. The `isConnected` flag below feeds the
  // reconnect resync: realtime is best-effort and events sent while the
  // WS was disconnected (laptop sleep, network blip, background-tab
  // throttle) are simply lost. We need a way to catch up.
  const { isConnected } = useRealtime({
    channelName: "inbox-realtime",
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
    enabled: true,
  });

  /**
   * Bump `resyncToken` whenever the realtime channel transitions from
   * disconnected → connected *after* the initial connect. The initial
   * connect is covered by the children's on-mount fetches; only later
   * reconnects need a manual refetch to fill the gap.
   *
   * Tracked via a `was-connected` ref rather than a count so that React
   * strict-mode's dev-only effect double-fire doesn't read as a
   * reconnect.
   */
  const wasConnectedRef = useRef(false);
  const initialConnectDoneRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) {
      // false → true transition
      if (initialConnectDoneRef.current) {
        setResyncToken((n) => n + 1);
      } else {
        initialConnectDoneRef.current = true;
      }
    }
    wasConnectedRef.current = isConnected;
  }, [isConnected]);

  /**
   * Refetch when the tab regains focus. Background tabs may have their
   * WS throttled by the browser even without a full disconnect, so a
   * visibilitychange → visible is a reliable signal that we may have
   * missed events. Cheap to fire; the children dedupe on their own.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setResyncToken((n) => n + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /**
   * Manual refresh trigger for the thread-header refresh button.
   * Bumps the same resyncToken the reconnect / visibility paths use,
   * so it goes through the existing dedupe & refetch plumbing — no
   * separate code path to keep in sync.
   */
  const handleManualRefresh = useCallback(() => {
    setResyncToken((n) => n + 1);
  }, []);

  const handleConversationsLoaded = useCallback(
    (loaded: Conversation[]) => {
      setConversations(loaded);
      // Resolve a pending deep-link here rather than in an effect — this
      // is an event handler, so the setState calls below are allowed by
      // react-hooks/set-state-in-effect. Runs once per ?c=<id> URL value
      // via the ref, so realtime refreshes of the list can't snap the
      // user back to the deep-linked thread after they've navigated.
      if (
        deepLinkConvId &&
        autoSelectedForDeepLinkRef.current !== deepLinkConvId &&
        loaded.length > 0
      ) {
        autoSelectedForDeepLinkRef.current = deepLinkConvId;
        // If the deep-linked conversation is already the active one
        // (e.g. because the user clicked it in the list and we
        // router.replace()'d the URL, which made the ConversationList
        // refetch and land us back here), do NOT re-apply it. Doing so
        // would setMessages([]) on a thread whose messages have
        // already been loaded by MessageThread — and because
        // conversationId didn't change, MessageThread wouldn't
        // refetch. The thread would read "No messages yet" until a
        // full page reload rehydrated state from scratch.
        if (activeConversation?.id === deepLinkConvId) return;
        const match = loaded.find((c) => c.id === deepLinkConvId);
        if (match) {
          setActiveConversation(match);
          setActiveContact(match.contact ?? null);
          setMessages([]);
          // Mirror the optimistic unread reset that handleSelectConversation
          // does — the user just deep-linked into this conv, treat that the
          // same as a click. Leaves activeConversation.unread_count alone so
          // the MessageThread reset effect still fires the server UPDATE.
          if (match.unread_count > 0) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === match.id ? { ...c, unread_count: 0 } : c,
              ),
            );
          }
        }
      }
    },
    [deepLinkConvId, activeConversation?.id]
  );

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      // Re-clicking the already-active conversation would clear the
      // messages array, but the fetch effect in MessageThread only re-runs
      // when conversationId changes — so messages would stay empty until
      // the user navigated away and back. Bail out early instead.
      if (activeConversation?.id === conv.id) return;
      setActiveConversation(conv);
      setActiveContact(conv.contact ?? null);
      setMessages([]);
      // Optimistically clear the unread badge for this conv. The
      // server-side reset is fired by the unread-reset effect inside
      // MessageThread (which reads activeConversation.unread_count, not
      // the list copy — so we deliberately leave that intact below to
      // keep the effect firing), and the realtime UPDATE that comes
      // back will sync to 0 again as a no-op. Zeroing the list copy
      // here means the user sees the badge disappear the instant they
      // click instead of waiting for the round-trip — and it persists
      // even if the realtime UPDATE is dropped.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conv.id && c.unread_count > 0
            ? { ...c, unread_count: 0 }
            : c,
        ),
      );
      // Record the selection on the deep-link ref BEFORE we change the
      // URL. The router.replace below flips `deepLinkConvId`, which can
      // in turn cause ConversationList to refetch and eventually call
      // handleConversationsLoaded again. Without this line, the ref
      // still points at the previous value, the auto-select block
      // sees `ref !== deepLinkConvId`, fires a second time, and
      // clobbers the messages MessageThread just fetched.
      autoSelectedForDeepLinkRef.current = conv.id;
      // Reflect the selection in the URL so a refresh lands the user
      // back in the same thread, and so copy-paste links work. Use
      // replace() to avoid polluting browser history with every click.
      router.replace(`/inbox?c=${conv.id}`, { scroll: false });
    },
    [activeConversation?.id, router]
  );

  // Mobile "back" — deselect the conversation so the list pane comes
  // back. Also clears the ?c= param so a refresh lands on the list
  // instead of re-opening the thread the user just backed out of.
  const handleCloseConversation = useCallback(() => {
    setActiveConversation(null);
    setActiveContact(null);
    setMessages([]);
    // Clearing the ref lets the deep-link auto-selector fire again if
    // the user later visits /inbox?c=<same-id> — desirable UX.
    autoSelectedForDeepLinkRef.current = null;
    router.replace("/inbox", { scroll: false });
  }, [router]);


  const handleMessagesLoaded = useCallback((loaded: Message[]) => {
    setMessages(loaded);
  }, []);

  const handleNewMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
    // Optimistic color update: the realtime echo for the sender's own
    // send round-trips through the DB, so patch the map immediately
    // rather than waiting for it (mirrors the optimistic message bubble
    // itself, which message-thread.tsx already shows before the send
    // resolves).
    if (msg.sender_type === "agent" && msg.sender_id) {
      const senderId = msg.sender_id;
      setLastAgentSenderMap((prev) => {
        const next = new Map(prev);
        next.set(msg.conversation_id, senderId);
        return next;
      });
    }
  }, []);

  const handleUpdateMessage = useCallback(
    (id: string, updates: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
      );
    },
    []
  );

  // Local removal for a deleted message — covers both the optimistic
  // removal right after the agent confirms "Apagar mensagem" and the
  // realtime DELETE echoed back from Postgres (filter is a no-op the
  // second time, so calling it twice for the same id is harmless).
  const handleDeleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const handleStatusChange = useCallback(
    (conversationId: string, status: ConversationStatus) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, status } : c))
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) => (prev ? { ...prev, status } : prev));
      }
    },
    [activeConversation]
  );

  const handleMarkUnread = useCallback(
    (conversationId: string) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, unread_count: 1 } : c))
      );
      // This is always fired from the currently-open thread's header
      // menu. Leaving that conversation active would immediately undo
      // it: MessageThread's unread-reset effect fires whenever the
      // *active* conversation's unread_count goes above 0 and clears it
      // straight back to 0. Closing the thread (back to the list) is
      // what makes "mark as unread" actually stick, same as Gmail/most
      // inboxes do.
      if (activeConversation?.id === conversationId) {
        handleCloseConversation();
      }
    },
    [activeConversation, handleCloseConversation]
  );

  const handleAssignChange = useCallback(
    (conversationId: string, assignedAgentId: string | null) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, assigned_agent_id: assignedAgentId ?? undefined }
            : c
        )
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) =>
          prev
            ? { ...prev, assigned_agent_id: assignedAgentId ?? undefined }
            : prev
        );
      }
    },
    [activeConversation]
  );

  // On mobile (<lg) we show a SINGLE pane — either the list or the
  // thread — rather than cramming both side-by-side. Selecting a
  // conversation slides the thread in; the thread's back button pops
  // it back to the list. On lg+ both panes render side-by-side as
  // before, unchanged.
  const hasActiveConv = !!activeConversation;

  return (
    // Height: `calc(100% + 2rem)` (`+3rem` at `sm:`) — 100% of `<main>`'s
    // own content box, plus back the padding (`p-4`/`sm:p-6` in
    // dashboard-shell.tsx) that the `-m-4`/`sm:-m-6` below pulls this
    // panel out into, so it still reaches every edge `<main>` actually
    // has despite rendering edge-to-edge over the padding. `1rem`/
    // `1.5rem` match Tailwind's `p-4`/`p-6` exactly (has to: this is
    // literally undoing that padding, not an independent number).
    //
    // 2026-08-07, parte 19 (conversation-screen rebuild): this used to
    // be computed from raw viewport units instead — `100dvh` (or, for a
    // while, a JS `visualViewport` reading) minus a `--header-height`
    // custom property duplicating what Header.tsx's own rendered height
    // adds up to. That's a *second* height calculation, independent
    // from the one flexbox already performs for `<main>` in
    // dashboard-shell.tsx (`flex-1` there, sized once from the shell's
    // single `dvh`-based height) — two numbers that are *supposed* to
    // always agree, computed two different ways, one JS/viewport-based
    // and one CSS/flex-based. Every drift bug in this file's history
    // (partes 9, 10, 13, 16) came from exactly that shape: something
    // reading the viewport directly instead of just asking its own
    // parent how tall it already is. `100%` has no such gap — it *is*
    // `<main>`'s real rendered height, in the same layout pass, always;
    // wherever the shell's height itself comes from (`dvh`, `env()`,
    // whatever it needs to be) only has to be gotten right in the one
    // place that owns it (dashboard-shell.tsx), and it flows down
    // through ordinary CSS box inheritance from there — nothing in this
    // file re-derives it.
    <div
      ref={rootRef}
      className="-m-4 flex h-[calc(100%+2rem)] flex-col overflow-hidden sm:-m-6 sm:h-[calc(100%+3rem)]"
    >
      {/* WhatsApp connection banner — in the flex column, not absolute,
          so it pushes the panels down instead of overlapping them. */}
      {whatsappConnected === false && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2">
          <WifiOff className="h-4 w-4 text-amber-400" />
          <p className="text-xs text-amber-400">
            {t("whatsappNotConnected")}
          </p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Conversation list.
            Hidden on mobile when a conversation is selected so the
            thread can occupy the full width. Always visible on lg+. */}
        <div
          className={cn(
            "flex h-full flex-1 lg:flex-none",
            hasActiveConv ? "hidden lg:flex" : "flex",
          )}
        >
          <ConversationList
            activeConversationId={activeConversation?.id ?? null}
            onSelect={handleSelectConversation}
            conversations={conversations}
            onConversationsLoaded={handleConversationsLoaded}
            resyncToken={resyncToken}
            initialFilter={initialInboxFilter}
            profiles={profiles}
            lastAgentSenderMap={lastAgentSenderMap}
          />
        </div>

        {/* Center panel: Message thread.
            Hidden on mobile when no conversation is selected so the
            list can occupy the full width. Always visible on lg+
            (shows its own empty-state if no thread is picked yet).

            `min-w-0` is load-bearing: without it, a single wide piece
            of content inside the thread (long quote preview, very
            long URL in a message body) forces the flex child past
            its share and pushes the contact-sidebar panel off-screen
            on the right. Issue #165. */}
        <div
          className={cn(
            "flex h-full min-w-0 flex-1 lg:flex",
            hasActiveConv ? "flex" : "hidden lg:flex",
          )}
        >
          <MessageThread
            conversation={activeConversation}
            contact={activeContact}
            messages={messages}
            onMessagesLoaded={handleMessagesLoaded}
            onNewMessage={handleNewMessage}
            onUpdateMessage={handleUpdateMessage}
            onDeleteMessage={handleDeleteMessage}
            onStatusChange={handleStatusChange}
            onMarkUnread={handleMarkUnread}
            onAssignChange={handleAssignChange}
            onBack={handleCloseConversation}
            resyncToken={resyncToken}
            onRefresh={handleManualRefresh}
            contactPanelOpen={contactPanelOpen}
            onToggleContactPanel={handleToggleContactPanel}
          />
        </div>

        {/* Right panel: Contact sidebar — desktop only, collapsed by
            default until the agent opens it via the thread-header toggle
            (#258). On mobile it's always hidden (the `lg:block` below),
            so the toggle — which is itself desktop-only — never affects
            it.

            Always mounted (not conditionally rendered) so the width
            change animates as a slide instead of an instant pop: the
            outer wrapper's width transitions between `0` and the
            sidebar's own fixed width (`w-70`, matched here so the
            transition has a concrete end value — width can't animate
            to `auto`), clipped with `overflow-hidden` while collapsed.
            The inner wrapper stays pinned at the full width the whole
            time so `ContactSidebar`'s own content never reflows/
            squishes mid-transition — only how much of it is visible
            changes. */}
        <div
          className={cn(
            "hidden overflow-hidden transition-[width] duration-300 ease-in-out lg:block",
            contactPanelOpen ? "w-70" : "w-0",
          )}
        >
          <div className="h-full w-70">
            <ContactSidebar contact={activeContact} />
          </div>
        </div>
      </div>
    </div>
  );
}
