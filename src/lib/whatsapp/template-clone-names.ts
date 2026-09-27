// ============================================================
// Names for cloned templates: `<original>_<3 random letters>`,
// e.g. `order_update` → `order_update_kqm`. Meta template names allow
// lowercase letters, digits and underscores, up to 512 characters.
// ============================================================

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const SUFFIX_LENGTH = 3;
const NAME_MAX = 512;

/** `() => number in [0, 1)` — injectable so tests are deterministic. */
export type Random = () => number;

export function randomSuffix(random: Random = Math.random): string {
  let out = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    out += LETTERS[Math.floor(random() * LETTERS.length)];
  }
  return out;
}

/**
 * A clone name for `base` that is not in `taken`. Gives up (returns the
 * last candidate) after 200 tries — 26³ combinations make a collision
 * run that long practically impossible.
 */
export function cloneName(base: string, taken: ReadonlySet<string>, random: Random = Math.random): string {
  const stem = base.slice(0, NAME_MAX - SUFFIX_LENGTH - 1);
  let candidate = `${stem}_${randomSuffix(random)}`;
  for (let i = 0; i < 200 && taken.has(candidate); i++) {
    candidate = `${stem}_${randomSuffix(random)}`;
  }
  return candidate;
}

/** `count` distinct clone names for `base`, none of them in `taken`. */
export function cloneNames(
  base: string,
  count: number,
  taken: ReadonlySet<string>,
  random: Random = Math.random
): string[] {
  const used = new Set(taken);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = cloneName(base, used, random);
    used.add(name);
    out.push(name);
  }
  return out;
}
