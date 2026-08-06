import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests para el webhook Telnyx (Fase 1): bookkeeping de calls, dispatch de
// missed_call y SMS inbound. La firma Ed25519 se mockea a "ok"; la lógica de
// firma real se cubre en webhook-signature.test.ts.
// ---------------------------------------------------------------------------

const runAutomationsForTrigger = vi.hoisted(() => vi.fn(async (_: unknown) => []))

vi.mock('@/lib/telnyx/webhook-signature', () => ({
  verifyTelnyxWebhook: vi.fn(() => ({ ok: true })),
}))

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger,
}))

// ---- admin-client mock con estado por llamada -----------------------------
const callsByCtrl = new Map<string, Record<string, unknown>>()
const config = { account_id: 'acct-1', call_control_app_id: 'ccapp-1', default_from_number: '+15550000001' }
const contacts: Record<string, unknown>[] = []
const conversations: Record<string, unknown>[] = []
const messages: Record<string, unknown>[] = []
// Grabaciones subidas a storage en call.recording.saved.
const uploadedRecordings: { path: string; body: Buffer }[] = []

function eqOf(eqs: [string, unknown][], col: string) {
  const hit = eqs.find(([c]) => c === col)
  return hit ? (hit[1] as string) : undefined
}

function makeAdminMock() {
  function builder(table: string) {
    let insertMode = false
    let update: Record<string, unknown> | null = null
    const eqs: [string, unknown][] = []
    const b: Record<string, unknown> = {}

    const chain = () => b
    b.select = vi.fn((_cols?: string) => b)
    b.eq = vi.fn((c: string, v: unknown) => {
      eqs.push([c, v])
      return b
    })
    b.insert = vi.fn((payload: Record<string, unknown>) => {
      insertMode = true
      // El insert corre sobre un builder fresco (sin .eq()); key por el propio payload.
      const ctrl = (payload.telnyx_call_control_id as string) ?? 'new'
      if (table === 'calls') callsByCtrl.set(ctrl, { ...payload })
      if (table === 'contacts') contacts.push(payload)
      if (table === 'conversations') conversations.push(payload)
      if (table === 'messages') messages.push(payload)
      return b
    })
    b.update = vi.fn((payload: Record<string, unknown>) => {
      update = payload
      return b
    })

    const terminal = () => {
      // --- telnyx_config (tenancy) ---
      if (table === 'telnyx_config') {
        for (const [col, val] of eqs) {
          if ((config as Record<string, unknown>)[col] === val) {
            return { data: config, error: null }
          }
        }
        return { data: null, error: null }
      }
      // --- calls ---
      if (table === 'calls') {
        if (insertMode) return { data: { id: 'call-1' }, error: null }
        if (update) {
          const ctrl = eqOf(eqs, 'telnyx_call_control_id')
          const id = eqOf(eqs, 'id')
          if (id) {
            const row = [...callsByCtrl.values()].find((r) => r.id === id)
            if (row) Object.assign(row, update)
          } else if (ctrl) {
            const row = callsByCtrl.get(ctrl)
            if (row) Object.assign(row, update)
          }
          return { data: null, error: null }
        }
        const ctrl = eqOf(eqs, 'telnyx_call_control_id')
        const leg = eqOf(eqs, 'telnyx_call_leg_id')
        if (ctrl) return { data: callsByCtrl.get(ctrl) ?? null, error: null }
        if (leg) {
          const hit = [...callsByCtrl.values()].find((r) => r.telnyx_call_leg_id === leg)
          return { data: hit ?? null, error: null }
        }
        return { data: null, error: null }
      }
      // --- contacts / conversations / messages ---
      if (table === 'contacts') {
        if (insertMode) return { data: { id: 'contact-new' }, error: null }
        const phoneN = eqOf(eqs, 'phone_normalized')
        const hit = contacts.find((c) => c.phone_normalized === phoneN)
        return { data: hit ?? null, error: null }
      }
      if (table === 'conversations') {
        if (insertMode) {
          const created = { id: 'conv-new' }
          conversations.push(created)
          return { data: created, error: null }
        }
        const cid = eqOf(eqs, 'contact_id')
        const hit = conversations.find((c) => c.contact_id === cid)
        return { data: hit ?? null, error: null }
      }
      if (table === 'messages') {
        if (insertMode) return { data: { id: 'msg-1' }, error: null }
        const tmid = eqOf(eqs, 'metadata->telnyx_message_id')
        if (tmid) {
          const hit = messages.find(
            (m) => (m.metadata as Record<string, unknown> | undefined)?.telnyx_message_id === tmid,
          )
          return { data: hit ?? null, error: null }
        }
        return { data: null, error: null }
      }
      return { data: null, error: null }
    }

    b.maybeSingle = vi.fn(() => Promise.resolve(terminal()))
    b.single = vi.fn(() => Promise.resolve(terminal()))
    b.then = (resolve: (v: unknown) => unknown) => resolve(terminal())
    return b
  }
  return {
    from: vi.fn((table: string) => builder(table)),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async (path: string, body: Buffer, _opts?: unknown) => {
          uploadedRecordings.push({ path, body })
          return { data: { path }, error: null }
        }),
      })),
    },
  }
}

let adminMock = makeAdminMock()
vi.mock('@/lib/telnyx/admin-client', () => ({
  supabaseAdmin: () => adminMock,
}))

import { POST } from './route'

function postWebhook(eventType: string, payload: Record<string, unknown>) {
  const req = new Request('http://localhost/api/telnyx/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { event_type: eventType, payload } }),
  })
  return POST(req as unknown as Parameters<typeof POST>[0])
}

beforeEach(() => {
  callsByCtrl.clear()
  contacts.length = 0
  conversations.length = 0
  messages.length = 0
  uploadedRecordings.length = 0
  adminMock = makeAdminMock()
  runAutomationsForTrigger.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/telnyx/webhook', () => {
  it('bookkeeping: initiated → ringing → answered → ended', async () => {
    const base = {
      call_control_id: 'ctrl-1',
      call_session_id: 'sess-1',
      connection_id: 'ccapp-1',
      from: { phone_number: '+15551112222' },
      to: { phone_number: '+15550000001' },
    }
    await postWebhook('call.initiated', { ...base, direction: 'inbound' })
    await postWebhook('call.answered', base)
    await postWebhook('call.hangup', { ...base, direction: 'inbound', hangup_cause: 'user_busy', hangup_leg: 'callee', call_duration: 12 })

    const row = callsByCtrl.get('ctrl-1')
    expect(row).toMatchObject({ status: 'ended', direction: 'inbound', hangup_cause: 'user_busy' })
    expect(row?.duration_sec).toBe(12)
    // answered escribió answered_at
    expect(runAutomationsForTrigger).not.toHaveBeenCalled()
  })

  it('dispatch missed_call cuando inbound + leg agente + no contestó', async () => {
    const ctrl = { call_control_id: 'ctrl-9', call_session_id: 'sess-9', connection_id: 'ccapp-1' }
    await postWebhook('call.initiated', { ...ctrl, direction: 'inbound', from: { phone_number: '+15551112222' }, to: { phone_number: '+15550000001' } })
    await postWebhook('call.hangup', { ...ctrl, direction: 'inbound', hangup_cause: 'no_answer', hangup_leg: 'agent', from: { phone_number: '+15551112222' } })

    const row = callsByCtrl.get('ctrl-9')
    expect(row).toMatchObject({ disposition: 'missed', status: 'ended' })
    expect(runAutomationsForTrigger).toHaveBeenCalledTimes(1)
    expect(runAutomationsForTrigger.mock.calls[0][0]).toMatchObject({
      accountId: 'acct-1',
      triggerType: 'missed_call',
      context: { missed_call_number: '+15551112222' },
    })
  })

  it('NO marca missed en llamada contestada (no inbound o normal answered)', async () => {
    const ctrl = { call_control_id: 'ctrl-5', connection_id: 'ccapp-1' }
    // hangup normal sin leg agent y sin dirección inbound → no missed
    await postWebhook('call.hangup', { ...ctrl, direction: 'outbound', hangup_cause: 'normal', from: { phone_number: '+15550000001' }, to: { phone_number: '+15551112222' } })
    expect(runAutomationsForTrigger).not.toHaveBeenCalled()
  })

  it('ignora y ackea webhooks de account desconocido', async () => {
    const res = await postWebhook('call.initiated', {
      call_control_id: 'ctrl-x',
      connection_id: 'unknown-app',
      from: { phone_number: '+19999999999' },
    })
    expect(res.status).toBe(200)
    expect(callsByCtrl.size).toBe(0)
    expect(runAutomationsForTrigger).not.toHaveBeenCalled()
  })

  it('persiste SMS inbound: crea contacto+conversación+mensaje channel=sms', async () => {
    await postWebhook('message.received', {
      id: 'msg-remote-1',
      from: { phone_number: '+15553334444' },
      // Shape real de la API Telnyx: `to` es un ARRAY de destinatarios.
      to: [{ phone_number: '+15550000001' }],
      text: 'Hola',
    })

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ sender_type: 'customer', channel: 'sms', content_text: 'Hola' })
    expect((messages[0].metadata as { telnyx_message_id?: string })?.telnyx_message_id).toBe('msg-remote-1')
    expect(conversations.length).toBeGreaterThan(0)
    expect(runAutomationsForTrigger).not.toHaveBeenCalled()
  })

  it('dedupe SMS inbound: reentrega con el mismo telnyx_message_id no duplica', async () => {
    const payload = {
      id: 'msg-remote-dup',
      from: { phone_number: '+15554445555' },
      // Shape real de la API Telnyx: `to` es un ARRAY de destinatarios.
      to: [{ phone_number: '+15550000001' }],
      text: 'Dup',
    }
    await postWebhook('message.received', payload)
    await postWebhook('message.received', payload)

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ content_text: 'Dup', channel: 'sms' })
  })

  it('call.recording.saved: descarga mp3, sube a call-recordings y guarda proxy URL', async () => {
    // Fila calls existente (leg id para matchear).
    callsByCtrl.set('ctrl-rec', {
      id: 'call-rec-1',
      account_id: 'acct-1',
      telnyx_call_control_id: 'ctrl-rec',
      telnyx_call_leg_id: 'leg-rec-1',
      direction: 'inbound',
    })

    await postWebhook('call.recording.saved', {
      call_leg_id: 'leg-rec-1',
      call_session_id: 'sess-rec-1',
      connection_id: 'ccapp-1',
      recording_urls: { mp3: 'https://telnyx.example/rec.mp3' },
    })

    expect(uploadedRecordings).toHaveLength(1)
    const up = uploadedRecordings[0]
    expect(up.path).toMatch(/^account-acct-1\/\d+-recording\.mp3$/)
    // La fila quedó con recording_storage_path + recording_url = proxy.
    const row = callsByCtrl.get('ctrl-rec')
    expect(row?.recording_storage_path).toBe(up.path)
    expect(row?.recording_url).toBe('/api/telnyx/recordings/call-rec-1')
  })

  it('call.recording.saved sin mp3: no sube nada ni rompe', async () => {
    callsByCtrl.set('ctrl-rec2', {
      id: 'call-rec-2',
      account_id: 'acct-1',
      telnyx_call_control_id: 'ctrl-rec2',
      telnyx_call_leg_id: 'leg-rec-2',
    })
    await postWebhook('call.recording.saved', {
      call_leg_id: 'leg-rec-2',
      connection_id: 'ccapp-1',
      recording_urls: {},
    })
    expect(uploadedRecordings).toHaveLength(0)
  })
})