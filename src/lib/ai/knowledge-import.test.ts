import { describe, expect, it } from 'vitest'
import { parseKnowledgeImport } from './knowledge-import'

describe('parseKnowledgeImport', () => {
  it('accepts the wrapped and the bare-array form', () => {
    const docs = [{ title: ' A ', content: ' text ' }]
    const wrapped = parseKnowledgeImport({ documents: docs })
    const bare = parseKnowledgeImport(docs)
    expect(wrapped).toEqual({ ok: true, documents: [{ title: 'A', content: 'text' }] })
    expect(bare).toEqual(wrapped)
  })

  it('rejects empty, non-array and incomplete input', () => {
    expect(parseKnowledgeImport(null).ok).toBe(false)
    expect(parseKnowledgeImport({ documents: [] }).ok).toBe(false)
    expect(parseKnowledgeImport([{ title: 'x' }]).ok).toBe(false)
  })

  it('rejects duplicate titles case-insensitively', () => {
    const r = parseKnowledgeImport([
      { title: 'Pricing', content: 'a' },
      { title: 'pricing', content: 'b' },
    ])
    expect(r.ok).toBe(false)
  })

  it('enforces size limits', () => {
    expect(parseKnowledgeImport([{ title: 'x', content: 'y'.repeat(20_001) }]).ok).toBe(false)
    const many = Array.from({ length: 51 }, (_, i) => ({ title: `t${i}`, content: 'c' }))
    expect(parseKnowledgeImport(many).ok).toBe(false)
  })
})

describe('shipped example: Online Onward Tickets knowledge base', () => {
  it('parses cleanly', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const raw = readFileSync(
      join(process.cwd(), 'docs/examples/online-onward-tickets-knowledge.json'),
      'utf8',
    )
    const r = parseKnowledgeImport(JSON.parse(raw))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.documents.length).toBeGreaterThanOrEqual(10)
  })
})
