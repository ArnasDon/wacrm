import { describe, it, expect } from 'vitest'
import { latestUserMessage } from './query'

describe('latestUserMessage', () => {
  it('returns the most recent user turn', () => {
    expect(
      latestUserMessage([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'latest' },
      ]),
    ).toBe('latest')
  })

  it('falls back to the last message when none are user', () => {
    expect(latestUserMessage([{ role: 'assistant', content: 'only assistant' }])).toBe(
      'only assistant',
    )
  })

  it('returns empty string for no messages', () => {
    expect(latestUserMessage([])).toBe('')
  })

  it('uses only textual parts of a multimodal customer turn', () => {
    expect(
      latestUserMessage([
        {
          role: 'user',
          content: [
            { type: 'image_url', url: 'data:image/png;base64,eA==' },
            { type: 'text', text: 'A peça chegou partida' },
          ],
        },
      ]),
    ).toBe('A peça chegou partida')
  })
})
