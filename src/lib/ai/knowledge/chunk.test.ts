import { describe, expect, it } from 'vitest'
import { chunkKnowledgeText, normalizeKnowledgeText } from './chunk'

describe('normalizeKnowledgeText', () => {
  it('normalizes whitespace without losing paragraph boundaries', () => {
    expect(normalizeKnowledgeText(' A  B\r\n\r\n C\tD ')).toBe('A B\n\nC D')
  })
})

describe('chunkKnowledgeText', () => {
  it('returns no chunks for blank input', () => {
    expect(chunkKnowledgeText('   ')).toEqual([])
  })

  it('creates stable indexed chunks with token estimates', () => {
    const chunks = chunkKnowledgeText('Alpha beta gamma.\n\nDelta epsilon zeta.', {
      maxChars: 24,
      overlapChars: 6,
    })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatchObject({ chunkIndex: 0 })
    expect(chunks.every((chunk, index) => chunk.chunkIndex === index)).toBe(true)
    expect(chunks.every((chunk) => chunk.content.length <= 24)).toBe(true)
    expect(chunks.every((chunk) => chunk.tokenEstimate > 0)).toBe(true)
  })

  it('always advances with high overlap after early whitespace, sentence, or paragraph breaks', () => {
    const inputs = [
      'abcdefghijk lmnopqrstuv wxyz',
      'abcdefghij. klmnopqrstuv wxyz',
      'abcdefghijk\n\nlmnopqrstuv wxyz',
    ]

    for (const input of inputs) {
      const chunks = chunkKnowledgeText(input, { maxChars: 20, overlapChars: 19 })

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.every((chunk) => chunk.content.length <= 20)).toBe(true)
    }
  })

  it('rejects invalid chunk options', () => {
    expect(() => chunkKnowledgeText('hello', { maxChars: 10, overlapChars: 10 })).toThrow(
      'overlapChars must be smaller than maxChars',
    )
  })
})
