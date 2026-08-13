import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// El embudo de /reports: Visitas → Leads → Contactados → Ganados.
//
// Lo que se fija aquí es lo que no se ve a simple vista al leer el agregador:
//
//   1. «Contactados» cuenta CONTACTOS, no tratos. Un lead con tres tratos
//      abiertos es un contactado, no tres — y ese es justo el error que
//      convierte un embudo en una gráfica que se ensancha hacia abajo.
//   2. El umbral es la posición 2 («Contactado»), no la 1 («Contacto
//      intentado»). Contar intentos como contactos esconde el escalón que
//      normalmente hay que arreglar.
//   3. Sin visitas el embudo arranca en Leads. Si arrancara en 0, todos los
//      porcentajes siguientes saldrían 0 % y parecería que no convierte nada.
//   4. La consulta de page_view va acotada por cuenta: usa service-role, que
//      salta RLS.
// ---------------------------------------------------------------------------

interface Recorded {
  table: string
  eqs: [string, unknown][]
}

interface Fixture {
  contacts: { id: string; attribution: unknown }[]
  deals: {
    contact_id: string
    status: string
    value: unknown
    stage: { name: string; position: number } | null
  }[]
  pageViews: number
}

let recorded: Recorded[] = []
let fixture: Fixture

function makeAdminMock() {
  function builder(table: string) {
    const rec: Recorded = { table, eqs: [] }
    recorded.push(rec)
    const b: Record<string, unknown> = {}
    b.select = vi.fn(() => b)
    b.eq = vi.fn((c: string, v: unknown) => {
      rec.eqs.push([c, v])
      return b
    })
    b.gte = vi.fn(() => b)
    b.lte = vi.fn(() => b)
    b.in = vi.fn(() => b)
    const result =
      table === 'contacts'
        ? { data: fixture.contacts, error: null, count: fixture.contacts.length }
        : table === 'deals'
          ? { data: fixture.deals, error: null, count: fixture.deals.length }
          : { data: null, error: null, count: fixture.pageViews }
    b.then = (resolve: (v: unknown) => unknown) => resolve(result)
    return b
  }
  return { from: vi.fn((t: string) => builder(t)) }
}

let adminMock = makeAdminMock()
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => adminMock,
}))

import { loadAcquisition } from './acquisition'
import type { DateRange } from './queries'

const ACCOUNT = 'acct-1'
const RANGE: DateRange = {
  from: '2026-01-01T00:00:00Z',
  to: '2026-01-31T00:00:00Z',
}

const stage = (name: string, position: number) => ({ name, position })

/**
 * c1 ganado (posición 8) · c2 contactado (2) · c3 solo intentado (1) ·
 * c4 sin ningún trato · c5 contactado con DOS tratos.
 *
 * → leads 5, contactados 3 (c1, c2, c5), ganados 1.
 */
function baseFixture(pageViews: number): Fixture {
  return {
    contacts: ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => ({
      id,
      attribution: { channel: 'google' },
    })),
    deals: [
      { contact_id: 'c1', status: 'won', value: 1000, stage: stage('Servicio completado', 8) },
      { contact_id: 'c2', status: 'open', value: null, stage: stage('Contactado', 2) },
      { contact_id: 'c3', status: 'open', value: null, stage: stage('Contacto intentado', 1) },
      { contact_id: 'c5', status: 'open', value: null, stage: stage('Contactado', 2) },
      { contact_id: 'c5', status: 'open', value: null, stage: stage('Interés confirmado', 3) },
    ],
    pageViews,
  }
}

beforeEach(() => {
  recorded = []
  adminMock = makeAdminMock()
  fixture = baseFixture(100)
})

describe('embudo de adquisición', () => {
  it('encadena los cuatro peldaños con su caída', async () => {
    const report = await loadAcquisition(ACCOUNT, RANGE, 'channel')

    expect(report.funnel.map((s) => [s.key, s.count])).toEqual([
      ['visits', 100],
      ['leads', 5],
      ['contacted', 3],
      ['won', 1],
    ])

    // fromPrev es la caída de un peldaño al siguiente.
    expect(report.funnel.map((s) => s.fromPrev)).toEqual([null, 5, 60, 33.3])
    // fromTop siempre se mide contra el primero (100 visitas).
    expect(report.funnel.map((s) => s.fromTop)).toEqual([100, 5, 3, 1])
  })

  it('cuenta contactos y no tratos: c5 tiene dos y suma uno', async () => {
    const report = await loadAcquisition(ACCOUNT, RANGE, 'channel')
    expect(report.totals.contacted).toBe(3)
    expect(report.totals.leads).toBe(5)
    // Nunca puede haber más contactados que leads.
    expect(report.totals.contacted).toBeLessThanOrEqual(report.totals.leads)
  })

  it('no cuenta como contactado a quien solo se intentó (posición 1)', async () => {
    fixture = {
      ...baseFixture(10),
      contacts: [{ id: 'c3', attribution: null }],
      deals: [
        {
          contact_id: 'c3',
          status: 'open',
          value: null,
          stage: stage('Contacto intentado', 1),
        },
      ],
    }
    const report = await loadAcquisition(ACCOUNT, RANGE, 'channel')
    expect(report.totals.contacted).toBe(0)
  })

  it('un trato ganado cuenta como contactado aunque su etapa se haya movido', async () => {
    fixture = {
      ...baseFixture(10),
      contacts: [{ id: 'c9', attribution: null }],
      deals: [
        {
          contact_id: 'c9',
          status: 'won',
          value: 500,
          // Etapa reordenada a mano por debajo del umbral: el status manda.
          stage: stage('Etapa rara', 0),
        },
      ],
    }
    const report = await loadAcquisition(ACCOUNT, RANGE, 'channel')
    expect(report.totals.contacted).toBe(1)
    expect(report.totals.won).toBe(1)
  })

  it('sin visitas el embudo arranca en Leads', async () => {
    fixture = baseFixture(0)
    const report = await loadAcquisition(ACCOUNT, RANGE, 'channel')

    expect(report.funnel.map((s) => s.key)).toEqual(['leads', 'contacted', 'won'])
    // El primer peldaño disponible es el 100 %, no un 0 % heredado.
    expect(report.funnel[0].fromTop).toBe(100)
    expect(report.funnel[0].fromPrev).toBeNull()
  })

  it('la consulta de page_view va acotada por cuenta y por tipo', async () => {
    await loadAcquisition(ACCOUNT, RANGE, 'channel')

    const pv = recorded.filter((r) => r.table === 'tracking_events')
    expect(pv.length).toBeGreaterThan(0)
    for (const q of pv) {
      expect(q.eqs).toContainEqual(['account_id', ACCOUNT])
      expect(q.eqs).toContainEqual(['event_type', 'page_view'])
    }
  })

  it('ninguna consulta sale sin account_id', async () => {
    await loadAcquisition(ACCOUNT, RANGE, 'channel')
    for (const q of recorded) {
      expect(q.eqs.map(([c]) => c)).toContain('account_id')
    }
  })
})
