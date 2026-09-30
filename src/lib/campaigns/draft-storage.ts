// In-progress campaign wizard drafts, kept in sessionStorage so a page
// refresh returns to the same step with the same choices instead of
// starting over. Per tab, gone when the tab closes; cleared when the
// campaign is sent or a new one is started from the list page.
//
// Storage can be unavailable (private mode, blocked) or full — a big CSV
// can exceed the ~5 MB quota. Every call is best-effort: a draft that
// can't be saved in full is saved without the uploaded file (`shrink`),
// and a failed read just means a fresh wizard.

export const STANDARD_DRAFT_KEY = 'wacrm:campaign-draft:standard';
export const ADVANCED_DRAFT_KEY = 'wacrm:campaign-draft:advanced';
/** The campaign wizard's autosave (current). */
export const WIZARD_DRAFT_KEY = 'wacrm:campaign-wizard:v2';

interface Stored<T> {
  v: 1;
  data: T;
}

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored<T>;
    return parsed?.v === 1 ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveDraft<T>(
  key: string,
  data: T,
  shrink?: (data: T) => T
): void {
  const write = (value: T) =>
    window.sessionStorage.setItem(key, JSON.stringify({ v: 1, data: value }));
  try {
    write(data);
  } catch {
    try {
      if (shrink) write(shrink(data));
    } catch {
      // Storage unavailable — the wizard still works, just not across a refresh.
    }
  }
}

export function clearDraft(...keys: string[]): void {
  for (const key of keys) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}
