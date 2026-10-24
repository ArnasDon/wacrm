import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadActivity } from './queries'
import { visibleConversations } from '@/modulos/visibilidad/visibilidad'

interface Registro {
  tabla: string
  select?: string
  eq: [string, string][]
  orden: string[] // secuencia de llamadas: eq / order / limit
}

function dbFalso(porTabla: Record<string, unknown[]>) {
  const registros: Registro[] = []
  const db = {
    from(tabla: string) {
      const r: Registro = { tabla, eq: [], orden: [] }
      registros.push(r)
      const b: Record<string, unknown> = {
        select(s: string) {
          r.select = s
          return b
        },
        eq(c: string, v: string) {
          r.eq.push([c, v])
          r.orden.push('eq')
          return b
        },
        order() {
          r.orden.push('order')
          return b
        },
        limit() {
          r.orden.push('limit')
          return b
        },
        then(res: (v: unknown) => unknown) {
          return Promise.resolve({ data: porTabla[tabla] ?? [] }).then(res)
        },
      }
      return b
    },
  }
  return { db: db as unknown as SupabaseClient, registros }
}

const msg = (id: string, conv: string, asesor: string | null, at: string) => ({
  id,
  created_at: at,
  conversation_id: conv,
  conversations: {
    assigned_agent_id: asesor,
    contact_id: 'k' + conv,
    contacts: { name: 'Cliente ' + conv, phone: '+57' + conv },
  },
})

const mensajes = [
  msg('m1', 'c1', 'A1', '2026-10-24T10:00:00Z'),
  msg('m2', 'c2', 'A2', '2026-10-24T11:00:00Z'),
]

const asesor = visibleConversations({ userId: 'A1', rol: 'agent', moduloActivo: true })
const dueno = visibleConversations({ userId: 'OW', rol: 'owner', moduloActivo: true })
const apagado = visibleConversations({ userId: 'A1', rol: 'agent', moduloActivo: false })
const sinRol = visibleConversations({ userId: 'A1', rol: null, moduloActivo: true })

const hrefs = (items: { href?: string; kind: string }[]) =>
  items.filter((i) => i.kind === 'message').map((i) => i.href)

describe('loadActivity (visibilidad)', () => {
  it('apagado: mismo select que wacrm y todos los mensajes', async () => {
    const { db, registros } = dbFalso({ messages: mensajes })
    const items = await loadActivity(db, 50, apagado)
    const m = registros.find((r) => r.tabla === 'messages')!
    expect(m.select).toContain('conversations(contact_id')
    expect(m.select).not.toContain('!inner')
    expect(m.eq).toEqual([['sender_type', 'customer']])
    expect(hrefs(items)).toHaveLength(2)
  })

  it('sin vis: igual que wacrm', async () => {
    const { db, registros } = dbFalso({ messages: mensajes })
    const items = await loadActivity(db, 50)
    expect(registros.find((r) => r.tabla === 'messages')!.select).not.toContain('!inner')
    expect(hrefs(items)).toHaveLength(2)
  })

  it('owner: todas, sin acotar', async () => {
    const { db, registros } = dbFalso({ messages: mensajes })
    const items = await loadActivity(db, 50, dueno)
    expect(registros.find((r) => r.tabla === 'messages')!.eq).toEqual([['sender_type', 'customer']])
    expect(hrefs(items)).toHaveLength(2)
  })

  it('asesor: acota por conversations.assigned_agent_id y no pinta ajenos', async () => {
    const { db, registros } = dbFalso({ messages: mensajes })
    const items = await loadActivity(db, 50, asesor)
    const m = registros.find((r) => r.tabla === 'messages')!
    expect(m.eq).toContainEqual(['conversations.assigned_agent_id', 'A1'])
    expect(hrefs(items)).toEqual(['/inbox?c=c1'])
  })

  it('el feed del asesor trae sus mensajes aunque haya 40 ajenos más nuevos', async () => {
    const { db, registros } = dbFalso({ messages: mensajes })
    await loadActivity(db, 50, asesor)
    const m = registros.find((r) => r.tabla === 'messages')!
    // el acotamiento (eq) ocurre antes del limit
    expect(m.orden.lastIndexOf('eq')).toBeLessThan(m.orden.indexOf('limit'))
  })

  it('sin rol resuelto: ningún ítem de mensaje y no ejecuta la consulta de mensajes', async () => {
    const { db, registros } = dbFalso({ messages: mensajes })
    const items = await loadActivity(db, 50, sinRol)
    expect(registros.filter((r) => r.tabla === 'messages').every((r) => !r.orden.includes('limit'))).toBe(true)
    expect(hrefs(items)).toEqual([])
  })
})
