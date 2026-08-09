import { describe, expect, it } from 'vitest'
import { hasImageContent, mergeConsecutive, withoutImageContent } from './shared'

describe('multimodal provider helpers', () => {
  it('merges consecutive roles without losing image parts', () => {
    const merged = mergeConsecutive([
      {
        role: 'user',
        content: [
          { type: 'image_url', url: 'data:image/png;base64,eA==' },
          { type: 'text', text: 'first' },
        ],
      },
      { role: 'user', content: 'second' },
    ])

    expect(hasImageContent(merged)).toBe(true)
    expect(merged).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image_url', url: 'data:image/png;base64,eA==' },
          { type: 'text', text: 'first' },
          { type: 'text', text: '\n\n' },
          { type: 'text', text: 'second' },
        ],
      },
    ])
  })

  it('strips only pixels for a text-only model fallback', () => {
    expect(
      withoutImageContent([
        {
          role: 'user',
          content: [
            { type: 'image_url', url: 'data:image/png;base64,eA==' },
            { type: 'text', text: 'caption' },
          ],
        },
      ]),
    ).toEqual([{ role: 'user', content: [{ type: 'text', text: 'caption' }] }])
  })
})
