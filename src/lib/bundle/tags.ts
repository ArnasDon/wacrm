/**
 * Automation steps reference tags by UUID (`add_tag` / `remove_tag`
 * → `tag_id`), which only exists inside one account. For a portable
 * bundle, steps may carry `tag_name` instead; these helpers translate
 * in both directions. Pure — no I/O.
 */
import type { BundleStep } from './schema'

const TAG_STEPS = new Set(['add_tag', 'remove_tag'])

export function collectStepTagNames(steps: BundleStep[], into = new Set<string>()): string[] {
  for (const s of steps) {
    if (TAG_STEPS.has(s.step_type) && typeof s.step_config.tag_name === 'string') {
      const n = s.step_config.tag_name.trim()
      if (n) into.add(n)
    }
    collectStepTagNames(s.branches?.yes ?? [], into)
    collectStepTagNames(s.branches?.no ?? [], into)
  }
  return [...into]
}

export function applyStepTagIds(steps: BundleStep[], idByName: Map<string, string>): BundleStep[] {
  return steps.map((s) => {
    let cfg = s.step_config
    if (TAG_STEPS.has(s.step_type) && typeof cfg.tag_name === 'string') {
      const { tag_name, ...rest } = cfg as Record<string, unknown> & { tag_name: string }
      const id = idByName.get(tag_name.trim())
      cfg = { ...rest, ...(id ? { tag_id: id } : {}) }
    }
    const out: BundleStep = { ...s, step_config: cfg }
    if (s.branches) {
      out.branches = {
        yes: applyStepTagIds(s.branches.yes ?? [], idByName),
        no: applyStepTagIds(s.branches.no ?? [], idByName),
      }
    }
    return out
  })
}

/** Export direction: tag_id → tag_name when the id is known. */
export function stepsWithTagNames(
  steps: Array<Record<string, unknown>>,
  nameById: Map<string, string>,
): Array<Record<string, unknown>> {
  return steps.map((s) => {
    const out = { ...s }
    const cfg = s.step_config as Record<string, unknown> | undefined
    if (
      cfg &&
      TAG_STEPS.has(String(s.step_type)) &&
      typeof cfg.tag_id === 'string' &&
      nameById.has(cfg.tag_id)
    ) {
      const { tag_id, ...rest } = cfg as Record<string, unknown> & { tag_id: string }
      out.step_config = { ...rest, tag_name: nameById.get(tag_id) }
    }
    const br = s.branches as { yes?: Array<Record<string, unknown>>; no?: Array<Record<string, unknown>> } | undefined
    if (br) {
      out.branches = {
        yes: stepsWithTagNames(br.yes ?? [], nameById),
        no: stepsWithTagNames(br.no ?? [], nameById),
      }
    }
    return out
  })
}
