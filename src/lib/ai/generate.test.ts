import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateReply, parseGeneration, isRetryableAiError } from './generate'
import { AiError, type AiConfig } from './types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    autoScheduleAppointmentsEnabled: false,
    askCustomerTaxInfo: false,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as unknown as Response
}

function errResponse(status: number, json: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => json,
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('parseGeneration', () => {
  it('returns text with no handoff', () => {
    expect(parseGeneration('Hello there')).toEqual({
      text: 'Hello there',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      leadTemperature: null,
      appointmentProposal: null,
      quoteProposal: null,
      sentinelLeakDetected: false,
      quickReplyId: null,
      reservationProposal: null,
      usage: null,
    })
  })

  it('detects + strips the handoff sentinel', () => {
    expect(parseGeneration('[[HANDOFF]]')).toEqual({
      text: '',
      handoff: true,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      leadTemperature: null,
      appointmentProposal: null,
      quoteProposal: null,
      sentinelLeakDetected: false,
      quickReplyId: null,
      reservationProposal: null,
      usage: null,
    })
    expect(parseGeneration('Let me get a human [[HANDOFF]]')).toEqual({
      text: 'Let me get a human',
      handoff: true,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      leadTemperature: null,
      appointmentProposal: null,
      quoteProposal: null,
      sentinelLeakDetected: false,
      quickReplyId: null,
      reservationProposal: null,
      usage: null,
    })
  })

  it('detects + strips the mark-deal-won sentinel', () => {
    expect(parseGeneration('Great, all set! [[ACTION:mark_deal_won]]')).toEqual({
      text: 'Great, all set!',
      handoff: false,
      markDealWon: true,
      moveToStageName: null,
      sendCatalog: false,
      leadTemperature: null,
      appointmentProposal: null,
      quoteProposal: null,
      sentinelLeakDetected: false,
      quickReplyId: null,
      reservationProposal: null,
      usage: null,
    })
  })

  it('never signals both handoff and markDealWon confusingly — each sentinel is independent', () => {
    const res = parseGeneration('[[ACTION:mark_deal_won]]')
    expect(res.handoff).toBe(false)
    expect(res.markDealWon).toBe(true)
    expect(res.text).toBe('')
  })

  it('detects + strips the move-deal sentinel, capturing the stage name', () => {
    expect(parseGeneration('Sounds great! [[ACTION:move_deal:Negotiation]]')).toEqual({
      text: 'Sounds great!',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negotiation',
      sendCatalog: false,
      leadTemperature: null,
      appointmentProposal: null,
      quoteProposal: null,
      sentinelLeakDetected: false,
      quickReplyId: null,
      reservationProposal: null,
      usage: null,
    })
  })

  it('captures a multi-word / accented stage name verbatim', () => {
    const res = parseGeneration('Perfecto. [[ACTION:move_deal:Cotización enviada]]')
    expect(res.moveToStageName).toBe('Cotización enviada')
    expect(res.text).toBe('Perfecto.')
  })

  it('allows the purchase-confirmation and move-deal markers to appear together', () => {
    const res = parseGeneration(
      'All set! [[ACTION:move_deal:Negotiation]] [[ACTION:mark_deal_won]]',
    )
    expect(res.markDealWon).toBe(true)
    expect(res.moveToStageName).toBe('Negotiation')
    expect(res.text).toBe('All set!')
  })

  it('detects + strips the send-catalog sentinel', () => {
    expect(parseGeneration('Here you go! [[ACTION:send_catalog]]')).toEqual({
      text: 'Here you go!',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: true,
      leadTemperature: null,
      appointmentProposal: null,
      quoteProposal: null,
      sentinelLeakDetected: false,
      quickReplyId: null,
      reservationProposal: null,
      usage: null,
    })
  })

  it('allows send-catalog to appear alongside move-deal in the same reply', () => {
    const res = parseGeneration(
      'Claro, aquí tienes. [[ACTION:send_catalog]] [[ACTION:move_deal:Cotización]]',
    )
    expect(res.sendCatalog).toBe(true)
    expect(res.moveToStageName).toBe('Cotización')
    expect(res.text).toBe('Claro, aquí tienes.')
  })

  it('detects + strips the set-temperature sentinel', () => {
    expect(parseGeneration('Claro que sí! [[ACTION:set_temperature:hot]]')).toEqual({
      text: 'Claro que sí!',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      leadTemperature: 'hot',
      appointmentProposal: null,
      quoteProposal: null,
      sentinelLeakDetected: false,
      quickReplyId: null,
      reservationProposal: null,
      usage: null,
    })
  })

  it('accepts warm and cold, case-insensitively', () => {
    expect(parseGeneration('ok [[ACTION:set_temperature:WARM]]').leadTemperature).toBe('warm')
    expect(parseGeneration('ok [[ACTION:set_temperature:Cold]]').leadTemperature).toBe('cold')
  })

  it('ignores an invalid temperature value instead of trusting it', () => {
    const res = parseGeneration('ok [[ACTION:set_temperature:lukewarm]]')
    expect(res.leadTemperature).toBeNull()
  })

  it('allows set-temperature to appear alongside move-deal and send-catalog', () => {
    const res = parseGeneration(
      'Perfecto. [[ACTION:move_deal:Negociación]] [[ACTION:send_catalog]] [[ACTION:set_temperature:hot]]',
    )
    expect(res.moveToStageName).toBe('Negociación')
    expect(res.sendCatalog).toBe(true)
    expect(res.leadTemperature).toBe('hot')
    expect(res.text).toBe('Perfecto.')
  })

  it('passes usage straight through', () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    expect(parseGeneration('Hi', usage)).toEqual({
      text: 'Hi',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      leadTemperature: null,
      appointmentProposal: null,
      quoteProposal: null,
      sentinelLeakDetected: false,
      quickReplyId: null,
      reservationProposal: null,
      usage,
    })
  })

  it('detects + strips the schedule-appointment sentinel, capturing start/end/email', () => {
    const res = parseGeneration(
      '¡Listo! Tu cita queda confirmada. [[ACTION:schedule_appointment:2026-06-01T15:00:00Z|2026-06-01T16:00:00Z|ana@example.com]]',
    )
    expect(res.appointmentProposal).toEqual({
      start: '2026-06-01T15:00:00Z',
      end: '2026-06-01T16:00:00Z',
      email: 'ana@example.com',
    })
    expect(res.text).toBe('¡Listo! Tu cita queda confirmada.')
  })

  it('ignores a malformed schedule-appointment marker missing a part', () => {
    const res = parseGeneration('ok [[ACTION:schedule_appointment:2026-06-01T15:00:00Z|2026-06-01T16:00:00Z]]')
    expect(res.appointmentProposal).toBeNull()
  })

  it('allows schedule-appointment to appear alongside set-temperature', () => {
    const res = parseGeneration(
      'Confirmado. [[ACTION:set_temperature:hot]] [[ACTION:schedule_appointment:2026-06-01T15:00:00Z|2026-06-01T16:00:00Z|ana@example.com]]',
    )
    expect(res.leadTemperature).toBe('hot')
    expect(res.appointmentProposal).toEqual({
      start: '2026-06-01T15:00:00Z',
      end: '2026-06-01T16:00:00Z',
      email: 'ana@example.com',
    })
    expect(res.text).toBe('Confirmado.')
  })

  it('detects + strips the create-quote-chat sentinel, capturing format/items/contact fields', () => {
    const res = parseGeneration(
      '¡Aquí tienes! [[ACTION:create_quote_chat:pdf|Cama Montessori:1,Silla:2|CF|ana@example.com|Zona 10, Ciudad]]',
    )
    expect(res.quoteProposal).toEqual({
      format: 'pdf',
      items: [
        { name: 'Cama Montessori', qty: 1 },
        { name: 'Silla', qty: 2 },
      ],
      customerNit: 'CF',
      customerEmail: 'ana@example.com',
      customerAddress: 'Zona 10, Ciudad',
    })
    expect(res.text).toBe('¡Aquí tienes!')
  })

  it('parses the text format explicitly and defaults anything else to pdf', () => {
    const asText = parseGeneration('ok [[ACTION:create_quote_chat:text|Silla:1|CF|a@b.com|Dir]]')
    expect(asText.quoteProposal?.format).toBe('text')

    const garbageFormat = parseGeneration('ok [[ACTION:create_quote_chat:whatever|Silla:1|CF|a@b.com|Dir]]')
    expect(garbageFormat.quoteProposal?.format).toBe('pdf')
  })

  it('defaults a missing/invalid quantity to 1', () => {
    const res = parseGeneration('ok [[ACTION:create_quote_chat:pdf|Silla|CF|a@b.com|Dir]]')
    expect(res.quoteProposal?.items).toEqual([{ name: 'Silla', qty: 1 }])
  })

  it('ignores a create-quote-chat marker missing the address', () => {
    expect(parseGeneration('ok [[ACTION:create_quote_chat:pdf|Silla:1|CF|a@b.com|]]').quoteProposal).toBeNull()
  })

  it('treats N/A NIT/email as blank (ask_customer_tax_info off, migration 082)', () => {
    const res = parseGeneration('ok [[ACTION:create_quote_chat:pdf|Silla:1|N/A|N/A|Dir]]')
    expect(res.quoteProposal).toEqual({
      format: 'pdf',
      items: [{ name: 'Silla', qty: 1 }],
      customerNit: '',
      customerEmail: '',
      customerAddress: 'Dir',
    })
  })

  it('is case-insensitive and accepts "N/A" without the slash', () => {
    const res = parseGeneration('ok [[ACTION:create_quote_chat:pdf|Silla:1|n/a|NA|Dir]]')
    expect(res.quoteProposal?.customerNit).toBe('')
    expect(res.quoteProposal?.customerEmail).toBe('')
  })

  it('resolves the address from the last segment even if the model drops the NIT/email slots entirely (defense in depth, 2026-08-25 incident)', () => {
    const res = parseGeneration('ok [[ACTION:create_quote_chat:pdf|Silla:1|Dir]]')
    expect(res.quoteProposal).toEqual({
      format: 'pdf',
      items: [{ name: 'Silla', qty: 1 }],
      customerNit: '',
      customerEmail: '',
      customerAddress: 'Dir',
    })
  })

  it('never leaves a sentinel-shaped marker in customer-facing text, even one none of the named strippers recognize (2026-08-25 incident — a create_quote_chat marker reached a real customer verbatim)', () => {
    const res = parseGeneration('Perfecto, ya puedo prepararte la cotización. [[ACTION:create_quote_chat:text|Silla:1|N/A|N/A|Villa Canales]]')
    expect(res.text).toBe('Perfecto, ya puedo prepararte la cotización.')
    expect(res.text).not.toContain('[[')
  })

  it('force-strips a sentinel-shaped marker that no named stripper recognizes at all, as a last-resort safety net', () => {
    const res = parseGeneration('Hola, un momento. [[ACTION:some_future_marker:foo|bar]]')
    expect(res.text).toBe('Hola, un momento.')
    expect(res.text).not.toContain('[[')
  })

  it('ignores a create-quote-chat marker with no items', () => {
    const res = parseGeneration('ok [[ACTION:create_quote_chat:pdf||CF|a@b.com|Dir]]')
    expect(res.quoteProposal).toBeNull()
  })

  it('detects + strips the record-reservation sentinel, capturing category + partial fields', () => {
    const res = parseGeneration(
      'Perfecto, te confirmo disponibilidad en un momento. [[ACTION:record_reservation:habitaciones|servicio=Suite Deluxe;personas=2;entrada=2026-05-01;salida=2026-05-04]]',
    )
    expect(res.reservationProposal).toEqual({
      category: 'habitaciones',
      fields: {
        servicio: 'Suite Deluxe',
        personas: '2',
        entrada: '2026-05-01',
        salida: '2026-05-04',
      },
    })
    expect(res.text).toBe('Perfecto, te confirmo disponibilidad en un momento.')
  })

  it('accepts a reservation marker with just the category (bare interest)', () => {
    const res = parseGeneration('¿Para cuántas personas sería el spa? [[ACTION:record_reservation:spa|]]')
    expect(res.reservationProposal).toEqual({ category: 'spa', fields: {} })
  })

  it('ignores a reservation marker with an unknown category', () => {
    expect(parseGeneration('ok [[ACTION:record_reservation:golf|personas=4]]').reservationProposal).toBeNull()
  })

  it('allows a reservation marker alongside the temperature marker', () => {
    const res = parseGeneration(
      'Con gusto. [[ACTION:set_temperature:warm]] [[ACTION:record_reservation:eventos|servicio=Boda;fecha=2026-06-20;personas=120]]',
    )
    expect(res.leadTemperature).toBe('warm')
    expect(res.reservationProposal?.category).toBe('eventos')
    expect(res.reservationProposal?.fields).toMatchObject({ servicio: 'Boda', fecha: '2026-06-20', personas: '120' })
    expect(res.text).toBe('Con gusto.')
  })

  it('detects + strips the quick-reply sentinel, capturing the id', () => {
    const res = parseGeneration('[[QUICK_REPLY:qr-123]]')
    expect(res.quickReplyId).toBe('qr-123')
    expect(res.text).toBe('')
  })

  it('allows the quick-reply marker to appear alongside an independent marker like set-temperature', () => {
    const res = parseGeneration('[[QUICK_REPLY:qr-123]] [[ACTION:set_temperature:warm]]')
    expect(res.quickReplyId).toBe('qr-123')
    expect(res.leadTemperature).toBe('warm')
    expect(res.text).toBe('')
  })

  it('returns null quickReplyId when the marker is absent', () => {
    expect(parseGeneration('Just a normal reply.').quickReplyId).toBeNull()
  })
})

describe('isRetryableAiError', () => {
  it('is true for transient provider failure modes', () => {
    for (const code of ['timeout', 'rate_limited', 'network_error', 'provider_error', 'empty_response']) {
      expect(isRetryableAiError(new AiError('x', { code }))).toBe(true)
    }
  })

  it('is false for a rejected key and an unsupported provider', () => {
    expect(isRetryableAiError(new AiError('bad key', { code: 'invalid_key' }))).toBe(false)
    expect(isRetryableAiError(new AiError('nope', { code: 'unsupported_provider' }))).toBe(false)
  })

  it('is false for a non-AiError', () => {
    expect(isRetryableAiError(new Error('boom'))).toBe(false)
    expect(isRetryableAiError('boom')).toBe(false)
    expect(isRetryableAiError(null)).toBe(false)
  })
})

describe('generateReply — OpenAI', () => {
  it('calls the chat completions endpoint and returns the reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Sure — happy to help!' } }],
        usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res).toEqual({
      text: 'Sure — happy to help!',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      leadTemperature: null,
      appointmentProposal: null,
      quoteProposal: null,
      sentinelLeakDetected: false,
      quickReplyId: null,
      reservationProposal: null,
      usage: { promptTokens: 42, completionTokens: 8, totalTokens: 50 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com')
    expect(opts.headers.Authorization).toBe('Bearer sk-test')
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        errResponse(401, { error: { message: 'Incorrect API key' } }),
      ),
    )

    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 })
  })

  it('throws on an empty completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '' } }] })),
    )
    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toBeInstanceOf(AiError)
  })
})

describe('generateReply — Anthropic', () => {
  it('calls the messages endpoint with the version header and parses text blocks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        content: [{ type: 'text', text: 'Hi there!' }],
        usage: { input_tokens: 30, output_tokens: 6 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'anthropic', apiKey: 'sk-ant-x' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    // Anthropic reports input/output only — total is summed by normalizeUsage.
    expect(res).toEqual({
      text: 'Hi there!',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      leadTemperature: null,
      appointmentProposal: null,
      quoteProposal: null,
      sentinelLeakDetected: false,
      quickReplyId: null,
      reservationProposal: null,
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.anthropic.com')
    expect(opts.headers['x-api-key']).toBe('sk-ant-x')
    expect(opts.headers['anthropic-version']).toBeTruthy()
  })

  it('detects handoff in the model output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ content: [{ type: 'text', text: '[[HANDOFF]]' }] }),
      ),
    )
    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'I want to speak to a person' }],
    })
    expect(res.handoff).toBe(true)
    expect(res.text).toBe('')
  })

  it('drops a leading assistant turn so the payload starts on the customer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [
        { role: 'assistant', content: 'Welcome!' },
        { role: 'user', content: 'Hi' },
      ],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages).toHaveLength(1)
  })
})
