import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Telefonía entrante — patrón de dos patas (migración 057).
//
// Estos tests cubren el CONTROL de llamada, no la contabilidad (esa vive en
// route.test.ts): que la pata A se conteste, que la pata B se cree sobre la
// conexión de credenciales —no sobre la Call Control App, que es la causa del
// 486— que el bridge se haga en la dirección correcta y que la pata huérfana
// se cuelgue.
//
// El cliente Telnyx se mockea entero: lo que se verifica es la orquestación
// del webhook, no el transporte HTTP.
// ---------------------------------------------------------------------------

vi.mock('@/lib/telnyx/webhook-signature', () => ({
  verifyTelnyxWebhook: vi.fn(() => ({ ok: true })),
}))

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(async () => []),
}))

const answerCall = vi.hoisted(() =>
  vi.fn(async (_ctrl: string, _clientState?: string) => {}),
)
const bridgeCalls = vi.hoisted(() => vi.fn(async (_ctrl: string, _other: string) => {}))
const hangupCall = vi.hoisted(() => vi.fn(async (_ctrl: string) => {}))
const dial = vi.hoisted(() =>
  vi.fn(async (_input: Record<string, unknown>) => ({
    callControlId: 'ctrl-B',
    callLegId: 'leg-B',
    callSessionId: 'sess-B',
  })),
)
const loadTelnyxInboundConfig = vi.hoisted(() => vi.fn())

vi.mock('@/lib/telnyx/api', () => ({
  createTelnyxClient: () => ({ answerCall, bridgeCalls, hangupCall, dial }),
  loadTelnyxInboundConfig,
}))

const INBOUND_CONFIG = {
  apiKey: 'KEY',
  credentialConnectionId: 'credconn-1',
  agentSipUri: 'sip:gencred-abc@sip.telnyx.com',
}

// ---- admin mock: solo lo que tocan estos handlers ------------------------
const callsByCtrl = new Map<string, Record<string, unknown>>()
let configRow: Record<string, unknown> = {
  account_id: 'acct-1',
  call_control_app_id: 'ccapp-1',
  credential_connection_id: 'credconn-1',
  default_from_number: '+15550000001',
}

function makeAdminMock() {
  function builder(table: string) {
    let insertMode = false
    let update: Record<string, unknown> | null = null
    const eqs: [string, unknown][] = []
    const b: Record<string, unknown> = {}
    const eqOf = (col: string) => eqs.find(([c]) => c === col)?.[1] as string | undefined

    b.select = vi.fn(() => b)
    b.eq = vi.fn((c: string, v: unknown) => {
      eqs.push([c, v])
      return b
    })
    b.insert = vi.fn(() => {
      insertMode = true
      return b
    })
    b.upsert = vi.fn((payload: Record<string, unknown>) => {
      insertMode = true
      const ctrl = (payload.telnyx_call_control_id as string) ?? 'new'
      if (table === 'calls') callsByCtrl.set(ctrl, { ...payload })
      return b
    })
    b.update = vi.fn((payload: Record<string, unknown>) => {
      update = payload
      return b
    })

    const terminal = () => {
      if (table === 'telnyx_config') {
        for (const [col, val] of eqs) {
          if (configRow[col] === val) return { data: configRow, error: null }
        }
        return { data: null, error: null }
      }
      if (table === 'calls') {
        if (insertMode) return { data: { id: 'call-x' }, error: null }
        const ctrl = eqOf('telnyx_call_control_id')
        if (update) {
          if (ctrl) {
            const row = callsByCtrl.get(ctrl) ?? {}
            Object.assign(row, update)
            callsByCtrl.set(ctrl, row)
          }
          return { data: null, error: null }
        }
        return { data: ctrl ? (callsByCtrl.get(ctrl) ?? null) : null, error: null }
      }
      return { data: null, error: null }
    }

    b.maybeSingle = vi.fn(() => Promise.resolve(terminal()))
    b.single = vi.fn(() => Promise.resolve(terminal()))
    b.then = (resolve: (v: unknown) => unknown) => resolve(terminal())
    return b
  }
  return { from: vi.fn((t: string) => builder(t)), storage: { from: vi.fn() } }
}

let adminMock = makeAdminMock()
vi.mock('@/lib/telnyx/admin-client', () => ({ supabaseAdmin: () => adminMock }))

import { POST } from './route'

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64')

function postWebhook(eventType: string, payload: Record<string, unknown>) {
  const req = new Request('http://localhost/api/telnyx/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { event_type: eventType, payload } }),
  })
  return POST(req as unknown as Parameters<typeof POST>[0])
}

const PSTN_STATE = b64({ v: 1, leg: 'pstn' })
const WEBRTC_STATE = b64({ v: 1, leg: 'webrtc', peer: 'ctrl-A' })

beforeEach(() => {
  callsByCtrl.clear()
  adminMock = makeAdminMock()
  configRow = {
    account_id: 'acct-1',
    call_control_app_id: 'ccapp-1',
    credential_connection_id: 'credconn-1',
    default_from_number: '+15550000001',
  }
  answerCall.mockClear()
  bridgeCalls.mockClear()
  hangupCall.mockClear()
  dial.mockClear()
  loadTelnyxInboundConfig.mockReset()
  loadTelnyxInboundConfig.mockResolvedValue(INBOUND_CONFIG)
})

const legA = {
  call_control_id: 'ctrl-A',
  call_session_id: 'sess-A',
  connection_id: 'ccapp-1',
  from: { phone_number: '+15551112222' },
  to: { phone_number: '+15550000001' },
}

describe('entrante: pata A', () => {
  it('contesta la llamada entrante marcándola en el client_state', async () => {
    await postWebhook('call.initiated', { ...legA, direction: 'incoming' })

    expect(answerCall).toHaveBeenCalledTimes(1)
    const [ctrl, state] = answerCall.mock.calls[0]
    expect(ctrl).toBe('ctrl-A')
    expect(JSON.parse(Buffer.from(String(state), 'base64').toString())).toEqual({
      v: 1,
      leg: 'pstn',
    })
    expect(callsByCtrl.get('ctrl-A')?.leg_role).toBe('pstn')
  })

  it('no contesta una saliente', async () => {
    await postWebhook('call.initiated', { ...legA, direction: 'outbound' })
    expect(answerCall).not.toHaveBeenCalled()
  })

  it('sin entrante configurado se queda en contabilidad', async () => {
    loadTelnyxInboundConfig.mockResolvedValue({
      apiKey: 'KEY',
      credentialConnectionId: null,
      agentSipUri: null,
    })
    await postWebhook('call.initiated', { ...legA, direction: 'incoming' })
    expect(answerCall).not.toHaveBeenCalled()
    expect(dial).not.toHaveBeenCalled()
  })

  it('una reentrega del mismo evento no vuelve a contestar', async () => {
    await postWebhook('call.initiated', {
      ...legA,
      direction: 'incoming',
      client_state: PSTN_STATE,
    })
    expect(answerCall).not.toHaveBeenCalled()
  })
})

describe('entrante: pata B', () => {
  it('crea la pata B sobre la CONEXIÓN DE CREDENCIALES, no sobre la CCA', async () => {
    await postWebhook('call.answered', { ...legA, client_state: PSTN_STATE })

    expect(dial).toHaveBeenCalledTimes(1)
    const arg = dial.mock.calls[0][0]
    // Este es el bug del 486: usar ccapp-1 aquí hace que el SIP responda ocupado.
    expect(arg.connectionId).toBe('credconn-1')
    expect(arg.connectionId).not.toBe('ccapp-1')
    expect(arg.to).toBe('sip:gencred-abc@sip.telnyx.com')

    expect(JSON.parse(Buffer.from(arg.clientState as string, 'base64').toString())).toEqual({
      v: 1,
      leg: 'webrtc',
      peer: 'ctrl-A',
    })
  })

  it('guarda el emparejamiento en las dos direcciones', async () => {
    await postWebhook('call.answered', { ...legA, client_state: PSTN_STATE })

    expect(callsByCtrl.get('ctrl-B')?.bridge_peer_control_id).toBe('ctrl-A')
    expect(callsByCtrl.get('ctrl-B')?.leg_role).toBe('webrtc')
    expect(callsByCtrl.get('ctrl-A')?.bridge_peer_control_id).toBe('ctrl-B')
  })

  it('al contestar el navegador, une las dos patas', async () => {
    await postWebhook('call.answered', {
      call_control_id: 'ctrl-B',
      connection_id: 'credconn-1',
      client_state: WEBRTC_STATE,
    })

    expect(bridgeCalls).toHaveBeenCalledWith('ctrl-B', 'ctrl-A')
    expect(dial).not.toHaveBeenCalled()
  })

  it('resuelve la cuenta por credential_connection_id (si no, se perdería el bridge)', async () => {
    // La pata B llega con el connection_id de la conexión de credenciales, que
    // no coincide con call_control_app_id.
    await postWebhook('call.answered', {
      call_control_id: 'ctrl-B',
      connection_id: 'credconn-1',
      client_state: WEBRTC_STATE,
    })
    expect(bridgeCalls).toHaveBeenCalled()
  })

  it('una saliente normal (sin client_state) no dispara nada', async () => {
    await postWebhook('call.answered', { ...legA })
    expect(dial).not.toHaveBeenCalled()
    expect(bridgeCalls).not.toHaveBeenCalled()
  })
})

describe('entrante: colgado', () => {
  it('cuelga la pata pareja usando el client_state', async () => {
    callsByCtrl.set('ctrl-A', { status: 'answered' })

    await postWebhook('call.hangup', {
      call_control_id: 'ctrl-B',
      connection_id: 'credconn-1',
      direction: 'outbound',
      client_state: WEBRTC_STATE,
    })

    expect(hangupCall).toHaveBeenCalledWith('ctrl-A')
  })

  it('cuelga la pata B huérfana cuando quien llama cuelga mientras suena', async () => {
    // La pata A no tiene peer en su client_state (se contestó antes de que la
    // pata B existiera): la pareja sale de calls.bridge_peer_control_id.
    callsByCtrl.set('ctrl-A', { bridge_peer_control_id: 'ctrl-B', status: 'answered' })
    callsByCtrl.set('ctrl-B', { status: 'ringing' })

    await postWebhook('call.hangup', {
      ...legA,
      direction: 'inbound',
      client_state: PSTN_STATE,
      hangup_cause: 'normal',
    })

    expect(hangupCall).toHaveBeenCalledWith('ctrl-B')
  })

  it('no intenta colgar una pata que ya terminó', async () => {
    callsByCtrl.set('ctrl-A', { status: 'ended' })

    await postWebhook('call.hangup', {
      call_control_id: 'ctrl-B',
      connection_id: 'credconn-1',
      client_state: WEBRTC_STATE,
    })

    expect(hangupCall).not.toHaveBeenCalled()
  })

  it('sin pareja no cuelga nada', async () => {
    await postWebhook('call.hangup', { ...legA, direction: 'inbound' })
    expect(hangupCall).not.toHaveBeenCalled()
  })
})
