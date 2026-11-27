import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { applyTagIds, collectTagNames } from '@/lib/flows/import'
import { validateFlowForActivation } from '@/lib/flows/validate'
import { parseBundle, summarizeBundle } from './schema'
import { applyStepTagIds, collectStepTagNames, stepsWithTagNames } from './tags'

const minimalFlow = {
  name: 'Mini',
  trigger_type: 'keyword',
  trigger_config: { keywords: ['hi'], match_type: 'exact' },
  nodes: [
    { node_key: 'start', node_type: 'start', config: { next_node_key: 'end' } },
    { node_key: 'end', node_type: 'end', config: {} },
  ],
}

describe('parseBundle', () => {
  it('accepts any subset of sections and the wrapped form', () => {
    expect(parseBundle({ flows: [minimalFlow] }).ok).toBe(true)
    expect(parseBundle({ bundle: { quick_replies: [{ title: 'Hi', content_text: 'Hello' }] } }).ok).toBe(true)
    expect(parseBundle({ ai: { knowledge: [{ title: 'A', content: 'B' }] } }).ok).toBe(true)
  })

  it('rejects non-objects and an empty bundle', () => {
    expect(parseBundle(null).ok).toBe(false)
    expect(parseBundle({}).ok).toBe(false)
  })

  it('prefixes errors with the section and index', () => {
    const r = parseBundle({ flows: [{ ...minimalFlow, name: '' }], quick_replies: [{ title: 'x' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith('flows[0]'))).toBe(true)
      expect(r.errors.some((e) => e.startsWith('quick_replies[0]'))).toBe(true)
    }
  })

  it('normalises template category case and rejects bad templates', () => {
    const ok = parseBundle({
      templates: [{ name: 'hello_world', category: 'UTILITY', body_text: 'Hello there friend' }],
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.bundle.templates[0].category).toBe('Utility')
      expect(ok.bundle.templates[0].language).toBe('en_US')
    }
    expect(parseBundle({ templates: [{ name: 'Bad Name', category: 'Utility', body_text: 'x' }] }).ok).toBe(false)
    expect(parseBundle({ templates: [{ name: 'a_b', category: 'Authentication', body_text: 'x' }] }).ok).toBe(false)
  })

  it('rejects duplicate quick-reply titles and AI config of the wrong type', () => {
    expect(
      parseBundle({
        quick_replies: [
          { title: 'A', content_text: 'x' },
          { title: 'a', content_text: 'y' },
        ],
      }).ok,
    ).toBe(false)
    expect(parseBundle({ ai: { config: { is_active: 'yes' } } }).ok).toBe(false)
  })

  it('clamps auto-reply max and parses automations with nested branches', () => {
    const r = parseBundle({
      ai: { config: { auto_reply_max_per_conversation: 99 } },
      automations: [
        {
          name: 'A',
          trigger_type: 'keyword_match',
          trigger_config: { keywords: ['x'], match_type: 'contains' },
          steps: [
            {
              step_type: 'condition',
              step_config: {},
              branches: { yes: [{ step_type: 'add_tag', step_config: { tag_name: 't' } }] },
            },
          ],
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bundle.ai?.config?.auto_reply_max_per_conversation).toBe(20)
      expect(collectStepTagNames(r.bundle.automations[0].steps)).toEqual(['t'])
    }
  })
})

describe('automation tag portability', () => {
  const steps = [
    {
      step_type: 'condition',
      step_config: {},
      branches: { yes: [{ step_type: 'add_tag', step_config: { tag_name: 'vip' } }], no: [] },
    },
  ]
  it('swaps names for ids and back', () => {
    const withIds = applyStepTagIds(steps, new Map([['vip', 'id-1']]))
    expect(withIds[0].branches?.yes?.[0].step_config).toEqual({ tag_id: 'id-1' })
    const back = stepsWithTagNames(withIds as never, new Map([['id-1', 'vip']]))
    const yes = (back[0].branches as { yes: Array<{ step_config: unknown }> }).yes
    expect(yes[0].step_config).toEqual({ tag_name: 'vip' })
  })
})

describe('shipped example: Online Onward Tickets bundle', () => {
  const raw = readFileSync(
    join(process.cwd(), 'docs/examples/online-onward-tickets.wacrm-bundle.json'),
    'utf8',
  )
  const parsed = parseBundle(JSON.parse(raw))

  it('parses with every section filled', () => {
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const s = summarizeBundle(parsed.bundle)
    expect(s.flows).toBe(1)
    expect(s.automations).toBe(1)
    expect(s.quick_replies).toBeGreaterThanOrEqual(15)
    expect(s.templates).toBe(11)
    expect(s.ai).toBeGreaterThanOrEqual(10)
  })

  it('has a flow that passes the activation validator', () => {
    if (!parsed.ok) throw new Error('did not parse')
    const f = parsed.bundle.flows[0]
    const ids = new Map(collectTagNames(f.nodes).map((n) => [n, `id-${n}`]))
    const issues = validateFlowForActivation(
      {
        name: f.name,
        trigger_type: f.trigger_type,
        trigger_config: f.trigger_config,
        entry_node_id: f.entry_node_id,
      },
      applyTagIds(f.nodes, ids),
    )
    expect(issues).toEqual([])
    expect(f.activate).toBe(false)
  })

  it('never switches auto-reply on by itself', () => {
    if (!parsed.ok) throw new Error('did not parse')
    expect(parsed.bundle.ai?.config?.auto_reply_enabled).toBe(false)
  })
})
