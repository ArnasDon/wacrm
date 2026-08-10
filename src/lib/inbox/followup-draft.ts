// ============================================================
// One-shot handoff from the Central de IA's follow-up flow to the
// Inbox composer (BLOCO 3/4). "Enviar pelo CRM" writes the AI-prepared
// draft here right before navigating to `/inbox?c=<conversationId>`;
// MessageThread reads + immediately clears it on mount for that
// conversation, so a page refresh never replays a stale draft and a
// draft never leaks into an unrelated conversation.
//
// sessionStorage (not a query param or shared React state) on purpose:
// it's a same-tab, one-shot signal to a page we're about to navigate
// to — exactly what it's for — without touching the Inbox's existing
// `?c=` deep-link parsing or introducing a store for a single value.
// ============================================================

export interface FollowupDraft {
  suggestionId: string;
  mode: 'free' | 'template';
  /** mode: 'free' */
  text?: string;
  /** mode: 'template' */
  templateId?: string;
  values?: { body: string[]; headerText?: string; buttonParams?: Record<number, string> };
}

const KEY_PREFIX = 'wacrm:followup-draft:';

export function writeFollowupDraft(conversationId: string, draft: FollowupDraft): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + conversationId, JSON.stringify(draft));
  } catch {
    // Storage disabled/full — the composer just won't be pre-filled;
    // the suggestion itself is untouched, nothing else breaks.
  }
}

export function consumeFollowupDraft(conversationId: string): FollowupDraft | null {
  try {
    const key = KEY_PREFIX + conversationId;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    sessionStorage.removeItem(key);
    return JSON.parse(raw) as FollowupDraft;
  } catch {
    return null;
  }
}
