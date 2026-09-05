"use client";

import { Suspense, useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from "@/lib/inbox/conversations";
import type { Conversation, Message, Contact, ConversationStatus } from "@/types";
import { useRealtime } from "@/hooks/use-realtime";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import { ContactSidebar } from "@/components/inbox/contact-sidebar";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@/hooks/use-is-desktop";

// Remembers the agent's show/hide choice for the desktop contact panel
// across reloads and sessions (device-scoped, like the theme prefs).
const CONTACT_PANEL_STORAGE_KEY = "wacrm:inbox:contact-panel-open";
// Same idea, for the desktop conversation-list panel — see
// `handleToggleListPanel` below.
const LIST_PANEL_STORAGE_KEY = "wacrm:inbox:list-panel-open";

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
   * Whether the desktop contact sidebar (tags / deals / notes) is shown.
   * Defaults to `true` (the historical behaviour) and is restored from
   * localStorage after mount. We deliberately do NOT read localStorage in
   * the initializer: the server renders with `true`, so reading a stored
   * `false` synchronously would produce a hydration mismatch. The effect
   * below reconciles to the stored value right after mount instead.
   */
  const [contactPanelOpen, setContactPanelOpen] = useState(true);
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

  /**
   * Same pattern as the contact panel above, for the conversation list.
   * Defaults to `true` (unchanged historical layout) and is reconciled
   * from localStorage post-mount to avoid a hydration mismatch.
   */
  const [listPanelOpen, setListPanelOpen] = useState(true);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LIST_PANEL_STORAGE_KEY);
      if (stored !== null) setListPanelOpen(stored === "true");
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
  }, []);

  const handleToggleListPanel = useCallback(() => {
    setListPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LIST_PANEL_STORAGE_KEY, String(next));
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

  // Whether we pushed a real history entry for the currently-open
  // thread (mobile only — see handleSelectConversation). Lets
  // handleCloseConversation pop it with router.back() instead of
  // guessing, and lets the popstate-sync effect below tell "the user
  // pressed our in-app back arrow" apart from "the phone's hardware
  // back/edge-swipe fired" without double-handling either.
  const pushedThreadHistoryRef = useRef(false);
  const isDesktop = useIsDesktop();

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
        // Never introduce a message-less conversation into the list (a
        // bare `conversation.started` row — see conversation-list.tsx).
        // If it's already shown, leave it; only guard the fresh-add path.
        if (!existing && !fetched.last_message_at && !fetched.last_message_text) {
          return prev;
        }
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

      // Post multi-number, an account can have several rows — this
      // banner only needs to know "is at least one connected", so
      // `.maybeSingle()` (which throws on ≥2 rows) is wrong here.
      const { data } = await supabase
        .from("whatsapp_config")
        .select("status")
        .eq("account_id", accountId)
        .eq("status", "connected")
        .limit(1);

      setWhatsappConnected((data?.length ?? 0) > 0);
    };

    checkConnection();
  }, []);

  // Handle realtime message events
  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message; old: Partial<Message> }) => {
      const newMsg = event.new;

      if (event.eventType === "INSERT") {
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
        // Skip conversations with no message yet — the WhatsApp-via-Zernio
        // webhook creates a bare conversation on `conversation.started`
        // (and Zernio fires that in bulk on a number reconnect). When a
        // real message lands, bump_conversation_on_inbound sets
        // last_message_at and the UPDATE branch below hydrates it in.
        if (!conv.last_message_at && !conv.last_message_text) return;
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

  // Mobile only: while a conversation is open, flag <html> so the app
  // chrome (top header + bottom tab bar) steps aside and the thread
  // runs full-screen, like opening a chat in WhatsApp. The CSS that
  // acts on `data-mobile-chat` is scoped to `max-width: 1023.98px`, so
  // desktop is unaffected regardless of this attribute. Cleared on
  // "back" and on unmount.
  useEffect(() => {
    const el = document.documentElement;
    if (activeConversation) {
      el.dataset.mobileChat = "true";
    } else {
      delete el.dataset.mobileChat;
    }
    return () => {
      delete el.dataset.mobileChat;
    };
  }, [activeConversation]);

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
      const openingFromList = !activeConversation?.id;
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
      // back in the same thread, and so copy-paste links work.
      //
      // On mobile, opening a thread takes over the whole screen
      // (data-mobile-chat hides the list) — push a real history entry
      // so the phone's back button / edge-swipe closes the thread
      // instead of leaving the inbox page entirely (it used to jump
      // straight back to wherever the agent was before /inbox, since
      // replace() never gave the OS back gesture a "list" state to
      // land on). Switching directly between threads can't happen on
      // mobile — the list is hidden while one is open — so this only
      // ever fires on the list → thread transition. Desktop shows list
      // + thread side by side and keeps the original replace()
      // behaviour so clicking through conversations doesn't pile up
      // history entries.
      if (!isDesktop && openingFromList) {
        pushedThreadHistoryRef.current = true;
        router.push(`/inbox?c=${conv.id}`, { scroll: false });
      } else {
        router.replace(`/inbox?c=${conv.id}`, { scroll: false });
      }
    },
    [activeConversation?.id, isDesktop, router]
  );

  // Mobile "back" (in-app arrow) — deselect the conversation so the
  // list pane comes back. If opening this thread pushed a history
  // entry (see handleSelectConversation), pop it with back() instead
  // of replacing — that keeps the browser's own back button in sync
  // with the in-app one rather than piling up an extra state each time.
  const handleCloseConversation = useCallback(() => {
    setActiveConversation(null);
    setActiveContact(null);
    setMessages([]);
    // Clearing the ref lets the deep-link auto-selector fire again if
    // the user later visits /inbox?c=<same-id> — desirable UX.
    autoSelectedForDeepLinkRef.current = null;
    if (pushedThreadHistoryRef.current) {
      pushedThreadHistoryRef.current = false;
      router.back();
    } else {
      router.replace("/inbox", { scroll: false });
    }
  }, [router]);

  // Syncs local state when the URL's ?c= param disappears WITHOUT
  // handleCloseConversation having run — i.e. the phone's hardware
  // back button or an edge-swipe drove a real popstate rather than an
  // in-app click. Without this, that gesture changes the address bar
  // but leaves the full-screen thread on screen until something else
  // happens to re-render it.
  const prevDeepLinkConvIdRef = useRef(deepLinkConvId);
  useEffect(() => {
    const prev = prevDeepLinkConvIdRef.current;
    prevDeepLinkConvIdRef.current = deepLinkConvId;
    if (deepLinkConvId === null && prev !== null && activeConversation) {
      setActiveConversation(null);
      setActiveContact(null);
      setMessages([]);
      autoSelectedForDeepLinkRef.current = null;
      pushedThreadHistoryRef.current = false;
    }
  }, [deepLinkConvId, activeConversation]);


  const handleMessagesLoaded = useCallback((loaded: Message[]) => {
    setMessages(loaded);
  }, []);

  // Older history paged in by scrolling up gets prepended, not
  // replaced — and de-duplicated in case a page overlaps something
  // already loaded (e.g. a realtime insert landed between fetches).
  const handleOlderMessagesLoaded = useCallback((older: Message[]) => {
    setMessages((prev) => {
      const existingIds = new Set(prev.map((m) => m.id));
      const deduped = older.filter((m) => !existingIds.has(m.id));
      if (deduped.length === 0) return prev;
      return [...deduped, ...prev];
    });
  }, []);

  const handleNewMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const handleUpdateMessage = useCallback(
    (id: string, updates: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
      );
    },
    []
  );

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
  // The list stays force-visible whenever there's nothing else to show
  // in its place — collapsing it with no active conversation would
  // leave the page blank on desktop. Only once a thread is open does
  // the agent's collapse choice take effect.
  const desktopListVisible = !hasActiveConv || listPanelOpen;

  return (
    <div
      className={cn(
        "-m-4 -mb-[calc(4.25rem+env(safe-area-inset-bottom))] flex flex-col overflow-hidden sm:-m-6 lg:mb-0 lg:h-[calc(100dvh-3.5rem)] lg:pb-0",
        // On mobile a picked conversation goes full-bleed (the app
        // header + tab bar are hidden via `data-mobile-chat`), so it
        // reclaims their height; the bottom inset keeps the composer
        // clear of the iOS home indicator. Otherwise the list keeps
        // room for both bars.
        hasActiveConv
          ? "h-[100dvh] pb-[env(safe-area-inset-bottom)]"
          : "h-[calc(100dvh-3.5rem-4.25rem-env(safe-area-inset-bottom))] sm:h-[calc(100dvh-3.5rem)]",
      )}
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
            thread can occupy the full width. On lg+ it's always visible
            UNLESS the agent collapsed it via the thread-header toggle
            while a conversation is open — see `desktopListVisible`. */}
        <div
          className={cn(
            "flex h-full flex-1 lg:flex-none",
            hasActiveConv ? "hidden" : "flex",
            desktopListVisible ? "lg:flex" : "lg:hidden",
          )}
        >
          <ConversationList
            activeConversationId={activeConversation?.id ?? null}
            onSelect={handleSelectConversation}
            conversations={conversations}
            onConversationsLoaded={handleConversationsLoaded}
            resyncToken={resyncToken}
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
            onOlderMessagesLoaded={handleOlderMessagesLoaded}
            onNewMessage={handleNewMessage}
            onUpdateMessage={handleUpdateMessage}
            onStatusChange={handleStatusChange}
            onAssignChange={handleAssignChange}
            onBack={handleCloseConversation}
            resyncToken={resyncToken}
            onRefresh={handleManualRefresh}
            contactPanelOpen={contactPanelOpen}
            onToggleContactPanel={handleToggleContactPanel}
            listPanelOpen={listPanelOpen}
            onToggleListPanel={handleToggleListPanel}
          />
        </div>

        {/* Right panel: Contact sidebar — desktop only, and only when the
            agent hasn't collapsed it via the thread-header toggle (#258).
            On mobile it's always hidden (the `lg:block` below), so the
            toggle — which is itself desktop-only — never affects it. */}
        {contactPanelOpen && (
          <div className="hidden lg:block">
            <ContactSidebar contact={activeContact} conversationId={activeConversation?.id ?? null} />
          </div>
        )}
      </div>
    </div>
  );
}
