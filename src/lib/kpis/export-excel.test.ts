import { describe, it, expect } from 'vitest'
import { buildKpiWorkbook } from './export-excel'
import type { ContactExportRow, KpiDataset } from './types'

function makeContacts(overrides: Partial<ContactExportRow>[] = []): ContactExportRow[] {
  if (overrides.length === 0) {
    return [
      {
        id: 'c1',
        name: 'Jane Doe',
        phone: '+15551234567',
        channel: 'whatsapp',
        createdAt: '2026-08-01T10:00:00',
        notes: 'Asking about pricing | Wants a demo',
        stage: 'Qualified',
      },
    ]
  }
  return overrides.map((o, i) => ({
    id: `c${i + 1}`,
    name: `Contact ${i + 1}`,
    phone: null,
    channel: 'whatsapp',
    createdAt: '2026-08-01T10:00:00',
    notes: '',
    stage: null,
    ...o,
  }))
}

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
    const wb = await buildKpiWorkbook(makeDataset(), 'USD', 'day', makeContacts())
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Summary',
      'Contacts',
      'Leads generated',
      'Qualified leads',
      'Deals won',
      'Lead temperature',
      'CAC history',
    ])
  })

  it('writes one row per contact in the Contacts sheet, with notes joined and stage filled in', async () => {
    const contacts = makeContacts([
      { name: 'Jane Doe', phone: '+15551234567', channel: 'whatsapp', notes: 'Asking about pricing | Wants a demo', stage: 'Qualified' },
      { name: 'Juan Perez', phone: null, channel: 'instagram', notes: '', stage: null },
    ])
    const wb = await buildKpiWorkbook(makeDataset(), 'USD', 'day', contacts)
    const sheet = wb.getWorksheet('Contacts')!
    expect(sheet.rowCount).toBe(3) // header + 2 contacts
    const rows = sheet.getSheetValues() as unknown[][]
    const jane = rows.find((r) => r?.[1] === 'Jane Doe')
    expect(jane).toEqual([undefined, 'Jane Doe', '+15551234567', 'whatsapp', expect.any(String), 'Asking about pricing | Wants a demo', 'Qualified'])
    const juan = rows.find((r) => r?.[1] === 'Juan Perez')
    expect(juan).toEqual([undefined, 'Juan Perez', '', 'instagram', expect.any(String), '', ''])
  })

  it('computes the summary sheet\'s headline numbers correctly', async () => {
    const wb = await buildKpiWorkbook(makeDataset(), 'USD', 'day', makeContacts())
    const summary = wb.getWorksheet('Summary')!
    const rows = summary.getSheetValues() as unknown[][]
    // Row 1 is the header; find the "Leads generated" row.
    const leadsRow = rows.find((r) => r?.[1] === 'Leads generated')
    expect(leadsRow?.[2]).toBe(2) // 2 leads in the fixture
    const cacRow = rows.find((r) => r?.[1] === 'Customer Acquisition Cost (CAC)')
    expect(cacRow?.[2]).toBe('USD 100.00') // 100 spend / 1 won deal
  })

  it('reports CAC as N/A when no spend was entered for the period', async () => {
    const wb = await buildKpiWorkbook(makeDataset({ currentPeriodSpend: null }), 'USD', 'day', makeContacts())
    const rows = wb.getWorksheet('Summary')!.getSheetValues() as unknown[][]
    const cacRow = rows.find((r) => r?.[1] === 'Customer Acquisition Cost (CAC)')
    expect(cacRow?.[2]).toContain('N/A')
  })

  it('writes one row per non-zero-filled bucket in the leads-generated sheet', async () => {
    const wb = await buildKpiWorkbook(makeDataset(), 'USD', 'day', makeContacts())
    const leadsSheet = wb.getWorksheet('Leads generated')!
    // header + 3 day-buckets (Aug 1, 2, 3) for the fixture's window.
    expect(leadsSheet.rowCount).toBe(4)
  })

  it('serializes to a real xlsx buffer', async () => {
    const wb = await buildKpiWorkbook(makeDataset(), 'USD', 'day', makeContacts())
    const buffer = await wb.xlsx.writeBuffer()
    expect(buffer.byteLength).toBeGreaterThan(0)
  })
})
