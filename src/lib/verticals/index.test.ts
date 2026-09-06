import { describe, it, expect } from 'vitest'
import {
  getVertical,
  listVerticals,
  isVerticalSlug,
  hiddenNavKeysFor,
  hiddenSettingsSectionsFor,
  VERTICAL_SLUGS,
} from './index'
import { getFlowTemplate } from '@/lib/flows/templates'
import { validateFlowForActivation } from '@/lib/flows/validate'

describe('vertical registry', () => {
  it('exposes exactly the slugs in the CHECK constraint', () => {
    expect([...VERTICAL_SLUGS].sort()).toEqual(['generic', 'hotel'])
  })

  it('isVerticalSlug narrows correctly', () => {
    expect(isVerticalSlug('hotel')).toBe(true)
    expect(isVerticalSlug('generic')).toBe(true)
    expect(isVerticalSlug('restaurant')).toBe(false)
    expect(isVerticalSlug(null)).toBe(false)
    expect(isVerticalSlug(42)).toBe(false)
  })

  it('getVertical returns null for unknown', () => {
    expect(getVertical('nope')).toBeNull()
  })

  it('listVerticals returns one entry per slug, each self-consistent', () => {
    const all = listVerticals()
    expect(all).toHaveLength(VERTICAL_SLUGS.length)
    for (const v of all) {
      expect(v.slug).toBeTruthy()
      expect(v.label).toBeTruthy()
      expect(Array.isArray(v.customFields)).toBe(true)
      expect(Array.isArray(v.flowTemplateSlugs)).toBe(true)
    }
  })

  it('generic is a no-op kit', () => {
    const g = getVertical('generic')!
    expect(g.customFields).toEqual([])
    expect(g.pipeline).toBeNull()
    expect(g.flowTemplateSlugs).toEqual([])
    expect(g.knowledgeDocs).toEqual([])
    expect(g.aiSystemPromptScaffold).toBeUndefined()
  })

  it('hotel kit is well-formed', () => {
    const h = getVertical('hotel')!
    expect(h.customFields.length).toBeGreaterThan(0)
    expect(h.pipeline?.name).toBe('Reservas')
    // exactly one won stage, and it's the last
    const won = h.pipeline!.stages.filter((s) => s.is_won)
    expect(won).toHaveLength(1)
    expect(h.pipeline!.stages.at(-1)?.is_won).toBe(true)
    expect(h.accountSettings.catalog_delivery_mode).toBe('photos')
    expect(h.aiSystemPromptScaffold).toBeTruthy()
    expect(h.knowledgeDocs.map((d) => d.title)).toEqual(['Tarifas', 'Políticas y horarios'])
  })

  it('every hotel flowTemplateSlug resolves to a valid, activatable template', () => {
    const h = getVertical('hotel')!
    for (const slug of h.flowTemplateSlugs) {
      const tpl = getFlowTemplate(slug)
      expect(tpl, `flow template "${slug}" must exist`).not.toBeNull()
      const issues = validateFlowForActivation(
        {
          name: tpl!.name,
          trigger_type: tpl!.trigger_type,
          trigger_config: tpl!.trigger_config as Record<string, unknown>,
          entry_node_id: tpl!.entry_node_id,
        },
        tpl!.nodes.map((n) => ({
          node_key: n.node_key,
          node_type: n.node_type,
          config: n.config as Record<string, unknown>,
        })),
      )
      expect(
        issues.filter((i) => i.severity === 'error'),
        `flow template "${slug}" should have no activation errors`,
      ).toEqual([])
    }
  })

  it('hidden-key helpers default to empty', () => {
    expect(hiddenNavKeysFor('generic')).toEqual([])
    expect(hiddenNavKeysFor('hotel')).toEqual([])
    expect(hiddenNavKeysFor('bogus')).toEqual([])
    expect(hiddenSettingsSectionsFor('hotel')).toEqual([])
  })
})
