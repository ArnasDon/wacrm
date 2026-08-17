import { describe, it, expect } from 'vitest'
import { buildKpiWorkbook } from './export-excel'
import type { KpiDataset } from './types'

function makeDataset(overrides: Partial<KpiDataset> = {}): KpiDataset {
  return {
    granularity: 'day',
    window: { start: new Date(2026, 7, 1), end: new Date(2026, 7, 3) },
    previousWindow: { start: new Date(2026, 6, 29), end: new Date(2026, 6, 31) },
    leads: [
      { id: 'c1', created_at: '2026-08-01T10:00:00', lead_temperature: 'hot' },
      { id: 'c2', created_at: '2026-08-02T10:00:00', lead_temperature: 'cold' },
    ],
    previousLeadsCount: 1,
    wonDeals: [
      { id: 'd1', won_at: '2026-08-01T12:00:00', updated_at: '2026-08-01T12:00:00', value: 500, currency: 'USD' },
    ],
    previousWonCount: 0,
    temperature: { cold: 1, warm: 0, hot: 1, unclassified: 0 },
    spendHistory: [{ id: 's1', period_start: '2026-08-01', period_end: '2026-08-03', amount: 100, currency: 'USD' }],
    currentPeriodSpend: { id: 's1', period_start: '2026-08-01', period_end: '2026-08-03', amount: 100, currency: 'USD' },
    ...overrides,
  }
}

describe('buildKpiWorkbook', () => {
  it('creates one sheet per dataset, in order', async () => {
    const wb = await buildKpiWorkbook(makeDataset(), 'USD', 'day')
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Summary',
      'Leads generated',
      'Qualified leads',
      'Deals won',
      'Lead temperature',
      'CAC history',
    ])
  })

  it('computes the summary sheet\'s headline numbers correctly', async () => {
    const wb = await buildKpiWorkbook(makeDataset(), 'USD', 'day')
    const summary = wb.getWorksheet('Summary')!
    const rows = summary.getSheetValues() as unknown[][]
    // Row 1 is the header; find the "Leads generated" row.
    const leadsRow = rows.find((r) => r?.[1] === 'Leads generated')
    expect(leadsRow?.[2]).toBe(2) // 2 leads in the fixture
    const cacRow = rows.find((r) => r?.[1] === 'Customer Acquisition Cost (CAC)')
    expect(cacRow?.[2]).toBe('USD 100.00') // 100 spend / 1 won deal
  })

  it('reports CAC as N/A when no spend was entered for the period', async () => {
    const wb = await buildKpiWorkbook(makeDataset({ currentPeriodSpend: null }), 'USD', 'day')
    const rows = wb.getWorksheet('Summary')!.getSheetValues() as unknown[][]
    const cacRow = rows.find((r) => r?.[1] === 'Customer Acquisition Cost (CAC)')
    expect(cacRow?.[2]).toContain('N/A')
  })

  it('writes one row per non-zero-filled bucket in the leads-generated sheet', async () => {
    const wb = await buildKpiWorkbook(makeDataset(), 'USD', 'day')
    const leadsSheet = wb.getWorksheet('Leads generated')!
    // header + 3 day-buckets (Aug 1, 2, 3) for the fixture's window.
    expect(leadsSheet.rowCount).toBe(4)
  })

  it('serializes to a real xlsx buffer', async () => {
    const wb = await buildKpiWorkbook(makeDataset(), 'USD', 'day')
    const buffer = await wb.xlsx.writeBuffer()
    expect(buffer.byteLength).toBeGreaterThan(0)
  })
})
