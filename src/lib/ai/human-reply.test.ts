import { describe, it, expect } from 'vitest'
import {
  classifyTrailingOutbound,
  classifyRecentAgentRows,
  isBusinessAutoReply,
  countHumanRepliesAfter,
  hasTeammateReply,
  humanReplySince,
  trailingCustomerTurns,
  type OutboundRow,
} from './human-reply'

const row = (over: Partial<OutboundRow>): OutboundRow => ({
  sender_type: 'agent',
  content_type: 'text',
  content_text: 'hola',
  created_at: '2026-09-26T10:00:00.000Z',
  ...over,
})

describe('classifyTrailingOutbound', () => {
  it('is unanswered when nothing was sent after the customer', () => {
    expect(classifyTrailingOutbound([])).toEqual({ kind: 'unanswered' })
  })

  it('ignores internal notes', () => {
    expect(classifyTrailingOutbound([row({ sender_type: 'bot', content_type: 'internal_note' })])).toEqual({
      kind: 'unanswered',
    })
  })

  it('any platform (bot) row means the bot already answered', () => {
    expect(classifyTrailingOutbound([row({}), row({ sender_type: 'bot' })])).toEqual({ kind: 'bot_answered' })
  })

  it('collects the human texts when only teammates answered', () => {
    expect(classifyTrailingOutbound([row({ content_text: 'Hola' }), row({ content_text: ' Sí hay ' })])).toEqual({
      kind: 'human_answered',
      humanTexts: ['Hola', 'Sí hay'],
    })
  })

  it('a human file/photo without text still counts as a human answer', () => {
    expect(classifyTrailingOutbound([row({ content_type: 'image', content_text: null })])).toEqual({
      kind: 'human_answered',
      humanTexts: ['(El asesor envió un archivo o imagen.)'],
    })
  })
})

describe('transcript helpers', () => {
  const msgs = [
    { role: 'assistant' as const, content: 'Bienvenido' },
    { role: 'user' as const, content: 'a' },
    { role: 'user' as const, content: 'b' },
    { role: 'assistant' as const, content: 'humano' },
  ]

  it('returns the customer turns at the end of the transcript', () => {
    expect(trailingCustomerTurns(msgs.slice(0, 3))).toEqual(['a', 'b'])
  })
})

describe('hasTeammateReply', () => {
  const r = (sender_type: string, created_at: string) => ({ sender_type, created_at })
  it('WhatsApp Business auto-greetings seconds after the customer are not a teammate (VSR, 2026-10-07)', () => {
    expect(
      hasTeammateReply([
        r('customer', '2026-10-07T03:09:45.994Z'),
        r('agent', '2026-10-07T03:09:51.023Z'),
        r('agent', '2026-10-07T03:09:51.291Z'),
      ]),
    ).toBe(false)
  })
  it('a person answering the customer takes the thread over', () => {
    expect(hasTeammateReply([r('customer', '2026-10-07T18:24:01Z'), r('agent', '2026-10-07T18:26:43Z')])).toBe(true)
  })
  it('a template the team sent before the customer ever wrote does not count', () => {
    expect(hasTeammateReply([r('agent', '2026-10-07T10:00:00Z'), r('customer', '2026-10-07T11:00:00Z')])).toBe(false)
  })
})

describe('humanReplySince', () => {
  // Villa San Ricardo, 2026-10-08: the WhatsApp Business app's greeting +
  // away message echoed ~4 s after a NEW guest wrote and silenced the AI.
  const customerAt = '2026-10-08T05:14:27.252Z'
  const echoAt = Date.parse('2026-10-08T05:14:31.570Z')
  it('ignores the app echo in a brand-new conversation', () => {
    expect(echoAt > Date.parse(humanReplySince(customerAt, true))).toBe(false)
  })
  it('counts every teammate reply in an active conversation, however fast', () => {
    expect(echoAt > Date.parse(humanReplySince(customerAt, false))).toBe(true)
  })
})

describe('delayed WhatsApp Business automatic messages', () => {
  const welcome = 'Gracias por comunicarse con Villa San Ricardo. ¿Cómo podemos ayudarle?'
  const away = 'Gracias por su mensaje.\nNuestro horario de atención es de 8:00am a 8:00pm, todos los días. \n\nCuéntenos cómo podemos ayudarle y le atenderemos lo más pronto posible.'
  const inbound = { sender_type: 'customer', content_text: 'Disponibilidad', created_at: '2026-10-14T19:57:25.542Z' }
  const echoes = [row({ content_text: welcome, created_at: '2026-10-14T19:57:45.050Z' }), row({ content_text: away, created_at: '2026-10-14T19:57:47.758Z' })]
  it('ignores both incident echoes without triggering the staff window or answering the customer', () => {
    expect(classifyRecentAgentRows([inbound, ...echoes], '2026-10-14T17:00:00Z')).toEqual({ humanReply: false, possibleEchoes: [] })
    expect(hasTeammateReply([inbound, ...echoes])).toBe(false)
    expect(classifyTrailingOutbound(echoes)).toEqual({ kind: 'unanswered' })
  })
  it('recognizes the exact greeting even if it arrives minutes later in an existing thread', () => {
    expect(classifyTrailingOutbound([row({ content_text: welcome, created_at: '2026-10-14T20:05:00Z' })])).toEqual({ kind: 'unanswered' })
  })
  it('preserves a real staff reply after the automatic messages', () => {
    const human = row({ content_text: 'No tenemos disponibilidad para este fin de semana.', created_at: '2026-10-14T20:10:00Z' })
    expect(classifyRecentAgentRows([inbound, ...echoes, human], '2026-10-14T17:00:00Z').humanReply).toBe(true)
    expect(hasTeammateReply([inbound, ...echoes, human])).toBe(true)
    expect(classifyTrailingOutbound([...echoes, human])).toEqual({ kind: 'human_answered', humanTexts: [human.content_text] })
  })
  it('does not discard a human answer that adds information after a greeting', () => {
    expect(isBusinessAutoReply(welcome + ' No tenemos disponibilidad.')).toBe(false)
    expect(isBusinessAutoReply('Gracias por su mensaje. Sí hay una habitación.')).toBe(false)
    expect(classifyTrailingOutbound([row({ sender_type: 'bot', content_text: welcome })]).kind).toBe('bot_answered')
  })
  it('excludes delayed automatic messages from the mid-generation human guard', async () => {
    const query = { select: () => query, eq: () => query, neq: () => query, gt: async () => ({ data: [...echoes, row({ content_text: 'Recepción debe revisar.' })], error: null }) }
    const db = { from: () => query } as unknown as Parameters<typeof countHumanRepliesAfter>[0]
    expect(await countHumanRepliesAfter(db, 'conversation', inbound.created_at)).toBe(1)
  })
})
