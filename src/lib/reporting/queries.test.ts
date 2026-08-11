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
}

const recorded: Recorded[] = []

function makeAdminMock() {
  function builder(table: string) {
    const rec: Recorded = { table, eqs: [], gtes: [], ltes: [] }
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
    b.in = vi.fn(() => b)
    b.order = vi.fn(() => b)
    b.limit = vi.fn(() => b)
    const result = { data: [], error: null, count: 0 }
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
  loadCalls,
  loadCampaigns,
  loadChannels,
  loadEmail,
  loadLost,
  loadOverview,
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
  ['loadEmail', loadEmail],
  ['loadCalls', loadCalls],
  ['loadTopLeads', loadTopLeads],
  ['loadLost', loadLost],
]

describe('tenencia — los ocho cargadores', () => {
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
