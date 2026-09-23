import type { ContentType, SenderType } from "@/types";

/**
 * Pure decision + formatting logic for desktop (Web Notifications API)
 * alerts about new inbound customer messages. Kept free of React and
 * browser globals (except the localStorage helpers at the bottom, which
 * guard for SSR) so the rules are unit-testable in the node vitest env.
 *
 * The hook in src/hooks/use-browser-notifications.ts feeds realtime
 * `messages` INSERTs through `shouldNotifyForMessage`, then renders the
 * result of `buildNotificationContent` with `new Notification(...)`.
 */

/** localStorage key for the device-scoped opt-in. */
export const BROWSER_NOTIFY_STORAGE_KEY = "wacrm:browser-notifications";

/**
 * Same-tab change signal. `storage` events only fire in *other* tabs,
 * so the settings toggle and the listener hook (both in this tab) sync
 * through this window event instead.
 */
export const BROWSER_NOTIFY_CHANGE_EVENT = "wacrm:browser-notifications-change";

/** A duplicate INSERT for the same message id inside this window is ignored. */
export const DEDUPE_WINDOW_MS = 30_000;

/** Body text is cut to roughly this many characters. */
export const BODY_MAX_CHARS = 120;

/** The subset of `Message` the decision + formatter need. */
export interface NotifiableMessage {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  content_type: ContentType;
  content_text?: string | null;
}

export interface ShouldNotifyOptions {
  /** `document.visibilityState === "visible"` at the time of the event. */
  documentVisible: boolean;
  /** Conversation the user has open in the inbox (`/inbox?c=<id>`), or null. */
  viewingConversationId: string | null;
  /**
   * Recently notified message ids → timestamp. Mutated in place: ids
   * that pass are recorded, stale ones are pruned. Callers keep one Map
   * per listener (a ref) so a replayed INSERT never double-fires.
   */
  seen: Map<string, number>;
  /** Injectable clock for tests. */
  now?: number;
}

/**
 * Decide whether an inbound `messages` INSERT deserves a desktop alert.
 *
 * - Only customer messages qualify (agent/bot sends are our own).
 * - Skipped when the tab is visible AND the user already has that
 *   conversation open — the thread itself is the notification.
 * - Deduped by message id within DEDUPE_WINDOW_MS (Realtime can replay
 *   an event on reconnect).
 */
export function shouldNotifyForMessage(
  msg: NotifiableMessage,
  opts: ShouldNotifyOptions,
): boolean {
  if (msg.sender_type !== "customer") return false;

  const now = opts.now ?? Date.now();
  for (const [id, at] of opts.seen) {
    if (now - at > DEDUPE_WINDOW_MS) opts.seen.delete(id);
  }
  if (opts.seen.has(msg.id)) return false;
  // Record before the visibility check: a replay of a message we chose
  // to stay silent on must stay silent too.
  opts.seen.set(msg.id, now);

  if (opts.documentVisible && opts.viewingConversationId === msg.conversation_id) {
    return false;
  }
  return true;
}

/**
 * Human labels used in the notification body. Plain English defaults;
 * the hook overrides them with next-intl strings when a translator is
 * available (notifications are not React-rendered, so the labels are
 * resolved by the caller and passed in).
 */
export interface NotificationLabels {
  /** Title when the contact has no resolvable name. */
  fallbackTitle: string;
  image: string;
  audio: string;
  video: string;
  document: string;
  location: string;
  template: string;
}

export const DEFAULT_NOTIFICATION_LABELS: NotificationLabels = {
  fallbackTitle: "New message",
  image: "📷 Photo",
  audio: "🎤 Voice message",
  video: "🎬 Video",
  document: "📄 Document",
  location: "📍 Location",
  template: "📋 Template",
};

export interface NotificationContent {
  title: string;
  body: string;
}

export function truncateBody(text: string, max = BODY_MAX_CHARS): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  // Cut on a word boundary when one exists reasonably close to the limit.
  const hard = collapsed.slice(0, max);
  const lastSpace = hard.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? hard.slice(0, lastSpace) : hard;
  return `${cut.trimEnd()}…`;
}

/**
 * Title = contact name (or a generic fallback); body = the text, or a
 * media descriptor with the caption appended when there is one.
 */
export function buildNotificationContent(
  msg: NotifiableMessage,
  contactName?: string | null,
  labels: NotificationLabels = DEFAULT_NOTIFICATION_LABELS,
): NotificationContent {
  const title = contactName?.trim() || labels.fallbackTitle;
  const text = msg.content_text?.trim() ?? "";

  let body: string;
  switch (msg.content_type) {
    case "image":
    case "audio":
    case "video":
    case "document":
    case "location":
    case "template": {
      const label = labels[msg.content_type];
      body = text ? `${label} · ${text}` : label;
      break;
    }
    // "text" and "interactive" (a tapped button/list row) both carry
    // their meaning in content_text.
    default:
      body = text;
  }

  return { title, body: truncateBody(body) };
}

/**
 * Display name for the notification title, in the order the inbox uses:
 * saved name, then WhatsApp username, then phone. Null when none exist.
 */
export function pickContactDisplayName(contact: {
  name?: string | null;
  wa_username?: string | null;
  phone?: string | null;
} | null | undefined): string | null {
  if (!contact) return null;
  if (contact.name?.trim()) return contact.name.trim();
  if (contact.wa_username?.trim()) return `@${contact.wa_username.trim()}`;
  if (contact.phone?.trim()) return contact.phone.trim();
  return null;
}

/**
 * Which conversation the user is looking at, derived from the URL. The
 * inbox mirrors its selection into `/inbox?c=<id>` (router.replace on
 * select), so this needs no shared React state.
 */
export function viewedConversationFromLocation(
  pathname: string,
  search: string,
): string | null {
  if (pathname.replace(/\/+$/, "") !== "/inbox") return null;
  return new URLSearchParams(search).get("c") || null;
}

/** Deep link the notification click navigates to. */
export function conversationHref(conversationId: string): string {
  return `/inbox?c=${encodeURIComponent(conversationId)}`;
}

// ---------------------------------------------------------------------
// Browser-only helpers (SSR-guarded).
// ---------------------------------------------------------------------

export type BrowserNotifyPermission = NotificationPermission | "unsupported";

export function getNotificationPermission(): BrowserNotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return window.Notification.permission;
}

/** Device-scoped opt-in. Defaults to off; a bad/absent value reads as off. */
export function readBrowserNotifyPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(BROWSER_NOTIFY_STORAGE_KEY) === "1";
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
    return false;
  }
}

export function writeBrowserNotifyPref(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      window.localStorage.setItem(BROWSER_NOTIFY_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(BROWSER_NOTIFY_STORAGE_KEY);
    }
  } catch {
    // Best-effort; the toggle still applies for this page's lifetime.
  }
  window.dispatchEvent(new Event(BROWSER_NOTIFY_CHANGE_EVENT));
}

/**
 * Subscribe to preference changes from this tab (custom event) and other
 * tabs (`storage`). Shaped for `useSyncExternalStore`.
 */
export function subscribeBrowserNotifyPref(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === BROWSER_NOTIFY_STORAGE_KEY) onChange();
  };
  window.addEventListener(BROWSER_NOTIFY_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(BROWSER_NOTIFY_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
