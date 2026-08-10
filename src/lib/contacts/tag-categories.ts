import type { Tag } from '@/types';

/**
 * Category whose tags represent a contact's primary classification
 * (today: "Moradia" / "Investimento", migration 039's seed). A
 * contact counts as "classified" once it carries ANY tag in this
 * category — driving the "Leads Aguardando Classificação" dashboard
 * card and its Contacts-list filter (migration 043) by category
 * membership rather than a hardcoded tag-name list, so adding a new
 * classification tag later needs no code change.
 */
export const CLASSIFICATION_CATEGORY = 'Finalidade';

// Sort priority for the real-estate qualification categories (migration
// 039) so they always group in the order a broker fills them out; any
// other category a user adds falls after these, alphabetically.
// Exported so the lead-analysis prompt (BLOCO 2/4) can reuse the exact
// same category vocabulary instead of duplicating it.
export const CATEGORY_ORDER = [
  'Finalidade',
  'Tipo de imóvel',
  'Bairro',
  'Faixa de valor',
  'Quartos',
  'Status',
  'Momento',
];

export function groupTagsByCategory(tags: Tag[]): [string | null, Tag[]][] {
  const groups = new Map<string | null, Tag[]>();
  for (const tag of tags) {
    const key = tag.category?.trim() || null;
    const list = groups.get(key);
    if (list) list.push(tag);
    else groups.set(key, [tag]);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === null) return 1;
    if (b === null) return -1;
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? CATEGORY_ORDER.length : ai) - (bi === -1 ? CATEGORY_ORDER.length : bi);
    }
    return a.localeCompare(b);
  });
}
