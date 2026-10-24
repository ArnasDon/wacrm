import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  calcularAtencion,
  cargarAtencionVisible,
  type ConversacionEnEspera,
  type EntradaAtencion,
} from './atencion-visible'
import { visibleConversations } from '@/modulos/visibilidad/visibilidad'

const ahora = Date.parse('2026-10-24T12:00:00Z')
const haceMin = (m: number) => new Date(ahora - m * 60_000).toISOString()
const haceHoras = (h: number) => haceMin(h * 60)

const conv = (id: string, extra: Partial<ConversacionEnEspera> = {}): ConversacionEnEspera => ({
  id,
  contactName: 'Cliente ' + id,
  contactPhone: '+57' + id,
  avatarUrl: null,
  preview: 'hola',
  assignedAgentId: 'A1',
  lastInboundAt: haceMin(5),
  lastReplyAt: null,
  handedOff: false,
  ...extra,
})

const entrada = (parcial: Partial<EntradaAtencion>): EntradaAtencion => ({
  conversaciones: [],
  entrantes: [],
  fallidos: [],
  ahora,
  objetivoMin: 15,
  ...parcial,
})

describe('calcularAtencion', () => {
  it('waitingSince = primer entrante después de la última respuesta', () => {
    const r = calcularAtencion(
      entrada({
        conversaciones: [conv('c1', { lastReplyAt: haceMin(120), lastInboundAt: haceMin(30) })],
        entrantes: [
          { conversationId: 'c1', createdAt: haceMin(150) },
          { conversationId: 'c1', createdAt: haceMin(90) },
          { conversationId: 'c1', createdAt: haceMin(30) },
        ],
      }),
    )
    expect(r.queue[0].waitingSince).toBe(haceMin(90))
  })

  it('sin entrantes posteriores usa lastInboundAt', () => {
    const r = calcularAtencion(entrada({ conversaciones: [conv('c1', { lastInboundAt: haceMin(40) })] }))
    expect(r.queue[0].waitingSince).toBe(haceMin(40))
  })

  it('una conversación ya respondida no cuenta', () => {
    const r = calcularAtencion(
      entrada({ conversaciones: [conv('c1', { lastInboundAt: haceMin(40), lastReplyAt: haceMin(10) })] }),
    )
    expect(r.waiting).toBe(0)
    expect(r.queue).toEqual([])
  })

  it('cuenta waiting, waitingOverTarget y oldestWaitingSince', () => {
    const r = calcularAtencion(
      entrada({
        conversaciones: [
          conv('c1', { lastInboundAt: haceMin(60) }),
          conv('c2', { lastInboundAt: haceMin(20) }),
          conv('c3', { lastInboundAt: haceMin(3) }),
        ],
      }),
    )
    expect(r.waiting).toBe(3)
    expect(r.waitingOverTarget).toBe(2)
    expect(r.oldestWaitingSince).toBe(haceMin(60))
  })

  it('windowsClosing: último entrante entre 22 y 24 h', () => {
    const r = calcularAtencion(
      entrada({
        conversaciones: [
          conv('c1', { lastInboundAt: haceHoras(23) }),
          conv('c2', { lastInboundAt: haceHoras(21) }),
          conv('c3', { lastInboundAt: haceHoras(25) }),
        ],
      }),
    )
    expect(r.windowsClosing).toBe(1)
  })

  it('unassigned es 0 para el asesor (R29)', () => {
    const r = calcularAtencion(entrada({ conversaciones: [conv('c1', { assignedAgentId: null })] }))
    expect(r.unassigned).toBe(0)
  })

  it('queue: las 6 más antiguas en orden, windowClosesAt = lastInboundAt + 24h', () => {
    const conversaciones = Array.from({ length: 8 }, (_, i) =>
      conv('c' + i, { lastInboundAt: haceMin(10 + i) }),
    )
    const r = calcularAtencion(entrada({ conversaciones }))
    expect(r.waiting).toBe(8)
    expect(r.queue).toHaveLength(6)
    expect(r.queue[0].conversationId).toBe('c7')
    expect(r.queue[0].windowClosesAt).toBe(new Date(Date.parse(haceMin(17)) + 24 * 3_600_000).toISOString())
  })

  it('failed cuenta todos; failedMessages los 10 más recientes', () => {
    const fallidos = Array.from({ length: 12 }, (_, i) => ({
      id: 'f' + i,
      conversationId: 'c1',
      contactName: null,
      contactPhone: null,
      preview: null,
      errorCode: null,
      errorTitle: null,
      at: haceMin(i + 1),
    }))
    const r = calcularAtencion(entrada({ fallidos }))
    expect(r.failed).toBe(12)
    expect(r.failedMessages).toHaveLength(10)
    expect(r.failedMessages[0].id).toBe('f0')
  })
})

function dbFalso(porTabla: Record<string, unknown[]>) {
  const consultas: string[] = []
  const db = {
    from(tabla: string) {
      consultas.push(tabla)
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'neq', 'not', 'eq', 'gte', 'in', 'order', 'limit']) {
        b[m] = () => b
      }
      b.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: porTabla[tabla] ?? [] }).then(res)
      return b
    },
  }
  return { db: db as unknown as SupabaseClient, consultas }
}

const asesor = visibleConversations({ userId: 'A1', rol: 'agent', moduloActivo: true })
const sinRol = visibleConversations({ userId: 'A1', rol: null, moduloActivo: true })

const filaConv = (id: string, asesorId: string) => ({
  id,
  assigned_agent_id: asesorId,
  last_message_text: 'hola',
  last_inbound_at: haceMin(30),
  last_reply_at: null,
  ai_autoreply_disabled: false,
  ai_handoff_summary: null,
  contact: { name: 'Cliente ' + id, phone: '+57' + id, avatar_url: null },
})

describe('cargarAtencionVisible', () => {
  it('el asesor no ve conversaciones ni fallidos ajenos', async () => {
    const { db } = dbFalso({
      conversations: [filaConv('c1', 'A1'), filaConv('c2', 'A2')],
      messages: [
        {
          id: 'f1',
          conversation_id: 'c1',
          content_text: 'x',
          error_code: 1,
          error_title: 'e',
          created_at: haceMin(5),
          conversations: { assigned_agent_id: 'A1', contacts: { name: 'N', phone: 'P' } },
        },
        {
          id: 'f2',
          conversation_id: 'c2',
          content_text: 'y',
          error_code: 1,
          error_title: 'e',
          created_at: haceMin(6),
          conversations: { assigned_agent_id: 'A2', contacts: { name: 'N', phone: 'P' } },
        },
      ],
    })
    const r = await cargarAtencionVisible(db, asesor, { ahora, objetivoMin: 15 })
    expect(r.queue.map((q) => q.conversationId)).toEqual(['c1'])
    expect(r.waiting).toBe(1)
    expect(r.failedMessages.map((f) => f.id)).toEqual(['f1'])
    expect(r.failed).toBe(1)
  })

  it('sin rol resuelto no consulta y devuelve atención vacía', async () => {
    const { db } = dbFalso({ conversations: [filaConv('c1', 'A1')] })
    const r = await cargarAtencionVisible(db, sinRol, { ahora, objetivoMin: 15 })
    expect(r.waiting).toBe(0)
    expect(r.queue).toEqual([])
    expect(r.failed).toBe(0)
  })
})
