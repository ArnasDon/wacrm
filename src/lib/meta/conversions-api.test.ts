import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================
// Coverage for conversions-api.ts (Bloco 4):
//   - reserva atómica por event_id: unique violation → não reenvia
//   - sem ctwa_clid na conversa → não tenta a chamada, regista o motivo
//   - sem meta_capi_dataset_id na conta → não tenta a chamada
//   - sem whatsapp_config / access_token → não tenta a chamada
//   - falha a decifrar o access_token → não tenta a chamada
//   - chamada bem sucedida → grava status 'sent'
//   - HTTP não-2xx da Meta → grava status 'error', nunca lança
//   - fetch rejeita (rede/timeout) → grava status 'error', nunca lança
//   - test_event_code, quando configurado, viaja no corpo do pedido
// ============================================================

const h = vi.hoisted(() => ({ decrypt: vi.fn() }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: h.decrypt }))

import { sendCapiEvent } from './conversions-api'
import { isUniqueViolation } from '@/lib/contacts/dedupe'

interface Row {
  data: unknown
  error: unknown
}

/** Fake Supabase client — cada tabela responde de acordo com `rows`,
 *  e cada `insert`/`update` fica registado em `writes` para os testes
 *  inspeccionarem o que foi persistido. */
function makeDb(opts: {
  conversations?: Row
  aiConfigs?: Row
  whatsappConfig?: Row
  insertResult?: { error: unknown }
}) {
  const {
    conversations = { data: { ctwa_clid: 'clid-123' }, error: null },
    aiConfigs = { data: { meta_capi_dataset_id: 'dataset-1', meta_capi_test_event_code: null }, error: null },
    whatsappConfig = { data: { access_token: 'enc-token', waba_id: 'waba-1' }, error: null },
    insertResult = { error: null },
  } = opts

  const writes: { table: string; op: 'insert' | 'update'; payload: Record<string, unknown> }[] = []

  const db = {
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        writes.push({ table, op: 'insert', payload })
        return Promise.resolve(insertResult)
      },
      update: (payload: Record<string, unknown>) => ({
        eq: () => {
          writes.push({ table, op: 'update', payload })
          return Promise.resolve({ error: null })
        },
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            if (table === 'conversations') return Promise.resolve(conversations)
            if (table === 'ai_configs') return Promise.resolve(aiConfigs)
            if (table === 'whatsapp_config') return Promise.resolve(whatsappConfig)
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }),
    }),
  }
  return { db, writes }
}

const originalFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
  h.decrypt.mockReturnValue('plaintext-access-token')
})

afterEach(() => {
  global.fetch = originalFetch
})

const ARGS = { accountId: 'acct-1', conversationId: 'conv-1', eventName: 'Lead' as const }

describe('sendCapiEvent', () => {
  it('reserva o event_id (insert pending) antes de tentar seja o que for', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"events_received":1}' })
    const { db, writes } = makeDb({})
    await sendCapiEvent({ db: db as never, ...ARGS })
    expect(writes[0]).toEqual({
      table: 'meta_capi_events',
      op: 'insert',
      payload: { conversation_id: 'conv-1', event_name: 'Lead', event_id: 'conv-1:Lead', status: 'pending' },
    })
  })

  it('desiste sem tentar a chamada quando a reserva perde a corrida (unique violation)', async () => {
    global.fetch = vi.fn()
    const { db } = makeDb({ insertResult: { error: { code: '23505', message: 'duplicate key' } } })
    await sendCapiEvent({ db: db as never, ...ARGS })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('regista o erro e não chama a Meta quando a conversa não tem ctwa_clid', async () => {
    global.fetch = vi.fn()
    const { db, writes } = makeDb({ conversations: { data: { ctwa_clid: null }, error: null } })
    await sendCapiEvent({ db: db as never, ...ARGS })
    expect(global.fetch).not.toHaveBeenCalled()
    const update = writes.find((w) => w.op === 'update')
    expect(update?.payload).toMatchObject({ status: 'error', response_summary: 'no_ctwa_clid' })
  })

  it('regista o erro e não chama a Meta sem meta_capi_dataset_id configurado', async () => {
    global.fetch = vi.fn()
    const { db, writes } = makeDb({ aiConfigs: { data: { meta_capi_dataset_id: null }, error: null } })
    await sendCapiEvent({ db: db as never, ...ARGS })
    expect(global.fetch).not.toHaveBeenCalled()
    const update = writes.find((w) => w.op === 'update')
    expect(update?.payload).toMatchObject({ status: 'error', response_summary: 'dataset_not_configured' })
  })

  it('regista o erro e não chama a Meta sem whatsapp_config/access_token', async () => {
    global.fetch = vi.fn()
    const { db, writes } = makeDb({ whatsappConfig: { data: null, error: null } })
    await sendCapiEvent({ db: db as never, ...ARGS })
    expect(global.fetch).not.toHaveBeenCalled()
    const update = writes.find((w) => w.op === 'update')
    expect(update?.payload).toMatchObject({ status: 'error', response_summary: 'whatsapp_config_not_found' })
  })

  it('regista o erro e não chama a Meta sem waba_id em whatsapp_config', async () => {
    global.fetch = vi.fn()
    const { db, writes } = makeDb({
      whatsappConfig: { data: { access_token: 'enc-token', waba_id: null }, error: null },
    })
    await sendCapiEvent({ db: db as never, ...ARGS })
    expect(global.fetch).not.toHaveBeenCalled()
    const update = writes.find((w) => w.op === 'update')
    expect(update?.payload).toMatchObject({ status: 'error', response_summary: 'waba_id_not_found' })
  })

  it('regista o erro quando o access_token não decifra', async () => {
    global.fetch = vi.fn()
    h.decrypt.mockImplementation(() => {
      throw new Error('bad key')
    })
    const { db, writes } = makeDb({})
    await sendCapiEvent({ db: db as never, ...ARGS })
    expect(global.fetch).not.toHaveBeenCalled()
    const update = writes.find((w) => w.op === 'update')
    expect(update?.payload).toMatchObject({ status: 'error', response_summary: 'access_token_decrypt_failed' })
  })

  it('envia o evento com o ctwa_clid e grava status sent na resposta 2xx', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"events_received":1}' })
    const { db, writes } = makeDb({})
    await sendCapiEvent({ db: db as never, ...ARGS })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('/dataset-1/events')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer plaintext-access-token')
    const body = JSON.parse(init.body)
    expect(body.data[0]).toMatchObject({
      event_name: 'Lead',
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: { ctwa_clid: 'clid-123', whatsapp_business_account_id: 'waba-1' },
      event_id: 'conv-1:Lead',
    })
    expect(body.test_event_code).toBeUndefined()

    const update = writes.find((w) => w.op === 'update')
    expect(update?.payload).toMatchObject({ status: 'sent', http_status: 200 })
  })

  it('inclui test_event_code no corpo quando configurado na conta', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' })
    const { db } = makeDb({
      aiConfigs: { data: { meta_capi_dataset_id: 'dataset-1', meta_capi_test_event_code: 'TEST123' }, error: null },
    })
    await sendCapiEvent({ db: db as never, ...ARGS })
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.test_event_code).toBe('TEST123')
  })

  it('grava status error com o http_status quando a Meta responde não-2xx, sem lançar', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => '{"error":"bad clid"}' })
    const { db, writes } = makeDb({})
    await expect(sendCapiEvent({ db: db as never, ...ARGS })).resolves.toBeUndefined()
    const update = writes.find((w) => w.op === 'update')
    expect(update?.payload).toMatchObject({ status: 'error', http_status: 400 })
  })

  it('grava status error quando o fetch rejeita (rede/timeout), sem lançar', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('timeout'))
    const { db, writes } = makeDb({})
    await expect(sendCapiEvent({ db: db as never, ...ARGS })).resolves.toBeUndefined()
    const update = writes.find((w) => w.op === 'update')
    expect(update?.payload.status).toBe('error')
  })

  it('usa event_id determinístico por conversa+evento, para dedupe', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' })
    const { db, writes } = makeDb({})
    await sendCapiEvent({ db: db as never, accountId: 'acct-1', conversationId: 'conv-9', eventName: 'Schedule' })
    const insert = writes.find((w) => w.op === 'insert')
    expect(insert?.payload.event_id).toBe('conv-9:Schedule')
  })
})

describe('isUniqueViolation (sanity — usado pela dedupe de sendCapiEvent)', () => {
  it('reconhece o código Postgres 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
    expect(isUniqueViolation({ code: 'other' })).toBe(false)
  })
})
