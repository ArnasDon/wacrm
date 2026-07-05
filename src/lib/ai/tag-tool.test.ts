import { describe, it, expect } from 'vitest'
import {
  buildAddTagTool,
  loadAssignableTags,
  dedupeAndCapToolCalls,
  type AssignableTag,
} from './tag-tool'

function fakeDb(rows: AssignableTag[] | null, error: unknown = null) {
  return {
    from: (table: string) => {
      expect(table).toBe('tags')
      const filters: [string, unknown][] = []
      const b = {
        select: () => b,
        eq: (k: string, v: unknown) => {
          filters.push([k, v])
          return b
        },
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve({ data: rows, error }).then(onF, onR),
      }
      return b
    },
    // Minimal shape — only `.from` is used by loadAssignableTags.
  } as unknown as Parameters<typeof loadAssignableTags>[0]
}

describe('loadAssignableTags', () => {
  it('returns the ai_assignable tags for the account', async () => {
    const rows = [{ id: 't1', name: 'quer-consultor' }]
    const tags = await loadAssignableTags(fakeDb(rows), 'acct-1')
    expect(tags).toEqual(rows)
  })

  it('returns an empty array on error rather than throwing', async () => {
    const tags = await loadAssignableTags(fakeDb(null, { message: 'boom' }), 'acct-1')
    expect(tags).toEqual([])
  })
})

describe('buildAddTagTool', () => {
  it('returns null when there are no assignable tags', () => {
    expect(buildAddTagTool([])).toBeNull()
  })

  it('builds a tool whose enum is exactly the assignable tag ids', () => {
    const tool = buildAddTagTool([
      { id: 't1', name: 'quer-consultor' },
      { id: 't2', name: 'vip' },
    ])
    expect(tool).not.toBeNull()
    expect(tool!.name).toBe('add_tag')
    expect(tool!.tagIds).toEqual(['t1', 't2'])
    // Names are surfaced in the description (ids alone aren't meaningful
    // to the model), but the enum itself stays pure ids.
    expect(tool!.description).toContain('t1 (quer-consultor)')
    expect(tool!.description).toContain('t2 (vip)')
  })
})

describe('dedupeAndCapToolCalls', () => {
  it('dedupes by tag id, keeping the first occurrence', () => {
    const result = dedupeAndCapToolCalls([
      { tagId: 't1', reason: 'first' },
      { tagId: 't1', reason: 'duplicate' },
      { tagId: 't2', reason: 'second' },
    ])
    expect(result).toEqual([
      { tagId: 't1', reason: 'first' },
      { tagId: 't2', reason: 'second' },
    ])
  })

  it('caps at MAX_AI_TAGS_PER_REPLY (2), dropping the rest', () => {
    const result = dedupeAndCapToolCalls([
      { tagId: 't1', reason: 'r1' },
      { tagId: 't2', reason: 'r2' },
      { tagId: 't3', reason: 'r3' },
    ])
    expect(result.map((r) => r.tagId)).toEqual(['t1', 't2'])
  })
})
