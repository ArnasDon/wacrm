import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tenencia de /reports.
//
// Los cargadores usan `supabaseAdmin()` (service-role), que salta RLS: si una
// consulta no lleva `.eq('account_id', …)` devuelve las filas de todas las
// cuentas. Aquí se graba cada consulta que sale y se comprueba que TODAS van
// acotadas — incluidas las de los helpers internos, que es por donde se
// reabriría el agujero sin que se note.
//
// También se fija el rango en Top leads, que antes se recibía y se tiraba.
// ---------------------------------------------------------------------------

interface Recorded {
  table: string
  eqs: [string, unknown][]
  gtes: [string, unknown][]
  ltes: [string, unknown][]
  ins: [string, unknown][]
}

const recorded: Recorded[] = []

// Datos por tabla para el caso específico de loadTimeInStage: la vista
// devuelve deals activos por etapa y pipeline_stages sus nombres/colores.
const TABLE_DATA: Record<string, unknown[]> = {
  deal_time_in_stage: [
    { stage_id: 's1', stage_entered_at: '2026-08-01T00:00:00Z', status: 'open' },
    { stage_id: 's2', stage_entered_at: '2026-08-10T00:00:00Z', status: 'open' },
  ],
  pipeline_stages: [
    { id: 's1', name: 'Nuevo', color: '#3b82f6', position: 0 },
    { id: 's2', name: 'Contactado', color: '#10b981', position: 1 },
  ],
}

function makeAdminMock() {
  function builder(table: string) {
    const rec: Recorded = { table, eqs: [], gtes: [], ltes: [], ins: [] }
    recorded.push(rec)
    const b: Record<string, unknown> = {}
    b.select = vi.fn(() => b)
    b.eq = vi.fn((c: string, v: unknown) => {
      rec.eqs.push([c, v])
      return b
    })
    b.gte = vi.fn((c: string, v: unknown) => {
      rec.gtes.push([c, v])
      return b
    })
    b.lte = vi.fn((c: string, v: unknown) => {
      rec.ltes.push([c, v])
      return b
    })
    b.in = vi.fn((c: string, v: unknown) => {
      rec.ins.push([c, v])
      return b
    })
    b.order = vi.fn(() => b)
    b.limit = vi.fn(() => b)
    const result = { data: TABLE_DATA[table] ?? [], error: null, count: 0 }
    b.maybeSingle = vi.fn(() => Promise.resolve(result))
    b.single = vi.fn(() => Promise.resolve(result))
    b.then = (resolve: (v: unknown) => unknown) => resolve(result)
    return b
  }
  return { from: vi.fn((t: string) => builder(t)) }
}

let adminMock = makeAdminMock()
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => adminMock,
}))

import {
  loadAds,
  loadCampaigns,
  loadChannels,
  loadLost,
  loadOverview,
  loadTimeInStage,
  loadTopLeads,
  type DateRange,
} from './queries'

const ACCOUNT = 'acct-1'
const RANGE: DateRange = { from: '2026-01-01T00:00:00Z', to: '2026-01-31T00:00:00Z' }

beforeEach(() => {
  recorded.length = 0
  adminMock = makeAdminMock()
})

const LOADERS: [string, (a: string, r: DateRange) => Promise<unknown>][] = [
  ['loadOverview', loadOverview],
  ['loadCampaigns', loadCampaigns],
  ['loadChannels', loadChannels],
  ['loadAds', loadAds],
  ['loadTopLeads', loadTopLeads],
  ['loadLost', loadLost],
]

describe('tenencia — los cargadores de reporting', () => {
  for (const [name, loader] of LOADERS) {
    it(`${name}: toda consulta lleva account_id`, async () => {
      await loader(ACCOUNT, RANGE)

      expect(recorded.length).toBeGreaterThan(0)
      const unscoped = recorded.filter(
        (r) => !r.eqs.some(([c, v]) => c === 'account_id' && v === ACCOUNT),
      )
      expect(
        unscoped.map((r) => r.table),
        `consultas sin account_id en ${name}`,
      ).toEqual([])
    })
  }
})

describe('rango de fechas', () => {
  it('loadTopLeads acota por el rango que recibe (antes lo ignoraba)', async () => {
    await loadTopLeads(ACCOUNT, RANGE)

    const deals = recorded.find((r) => r.table === 'deals')
    expect(deals).toBeDefined()
    expect(deals!.gtes).toContainEqual(['created_at', RANGE.from])
    expect(deals!.ltes).toContainEqual(['created_at', RANGE.to])
  })

  it('loadLost sigue acotando por lost_at', async () => {
    await loadLost(ACCOUNT, RANGE)

    const deals = recorded.find((r) => r.table === 'deals')
    expect(deals!.gtes).toContainEqual(['lost_at', RANGE.from])
    expect(deals!.ltes).toContainEqual(['lost_at', RANGE.to])
  })
})

describe('loadTimeInStage', () => {
  it('vista acotada por account + status open; stages acotados por in(id)', async () => {
    await loadTimeInStage(ACCOUNT)

    const view = recorded.find((r) => r.table === 'deal_time_in_stage')
    expect(view).toBeDefined()
    expect(view!.eqs).toContainEqual(['account_id', ACCOUNT])
    expect(view!.eqs).toContainEqual(['status', 'open'])

    const stages = recorded.find((r) => r.table === 'pipeline_stages')
    expect(stages).toBeDefined()
    // pipeline_stages NO tiene account_id (cuelga de pipelines vía
    // pipeline_id, 017): se acota por in(id) con los stage_ids que ya
    // salieron de los deals de ESTA cuenta. Nunca se tocan stages de otra.
    expect(stages!.eqs).toEqual([])
    expect(stages!.ins).toContainEqual(['id', ['s1', 's2']])
  })

  it('calcula mediana y máximo sobre stage_entered_at', async () => {
    const rows = await loadTimeInStage(ACCOUNT)
    expect(rows).toHaveLength(2)

    const s1 = rows.find((r) => r.stageId === 's1')
    const entered = new Date('2026-08-01T00:00:00Z').getTime()
    const expected = Math.floor((Date.now() - entered) / 1000)
    expect(s1).toBeDefined()
    expect(s1!.dealCount).toBe(1)
    expect(s1!.stageName).toBe('Nuevo')
    expect(s1!.medianSeconds).toBe(expected)
    expect(s1!.maxSeconds).toBe(expected)
    expect(s1!.color).toBe('#3b82f6')

    // Orden por posición de la etapa, no por id.
    expect(rows[0].stageId).toBe('s1')
    expect(rows[1].stageId).toBe('s2')
  })
})
