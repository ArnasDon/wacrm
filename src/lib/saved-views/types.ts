// Saved list views — shared shapes for the API, the hook and the UI.
// Migration 096_saved_views.sql.

export const SAVED_VIEW_RESOURCES = ["contacts"] as const;
export type SavedViewResource = (typeof SAVED_VIEW_RESOURCES)[number];

export const CONTACT_SORTS = ["recent", "oldest", "name", "name_desc"] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];

export function isContactSort(v: unknown): v is ContactSort {
  return typeof v === "string" && (CONTACT_SORTS as readonly string[]).includes(v);
}

/** `config` for a `resource: "contacts"` view. */
export interface ContactsViewConfig {
  search?: string;
  tagIds?: string[];
  sort?: ContactSort;
}

export interface SavedView {
  id: string;
  account_id: string;
  user_id: string;
  resource: SavedViewResource;
  name: string;
  config: ContactsViewConfig;
  is_shared: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

/** Normalise an untrusted object into a clean ContactsViewConfig. */
export function sanitizeContactsConfig(input: unknown): ContactsViewConfig {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: ContactsViewConfig = {};
  if (typeof o.search === "string" && o.search.trim()) out.search = o.search.trim().slice(0, 200);
  if (Array.isArray(o.tagIds)) {
    const ids = o.tagIds.filter((x): x is string => typeof x === "string").slice(0, 50);
    if (ids.length) out.tagIds = ids;
  }
  if (isContactSort(o.sort) && o.sort !== "recent") out.sort = o.sort;
  return out;
}

/** True when two configs would produce the same list. */
export function configsEqual(a: ContactsViewConfig, b: ContactsViewConfig): boolean {
  const na = sanitizeContactsConfig(a);
  const nb = sanitizeContactsConfig(b);
  const sa = [...(na.tagIds ?? [])].sort();
  const sb = [...(nb.tagIds ?? [])].sort();
  return (
    (na.search ?? "") === (nb.search ?? "") &&
    (na.sort ?? "recent") === (nb.sort ?? "recent") &&
    sa.length === sb.length &&
    sa.every((id, i) => id === sb[i])
  );
}
