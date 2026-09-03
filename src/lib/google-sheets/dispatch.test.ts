import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const H = vi.hoisted(() => ({
  from: vi.fn(),
  token: vi.fn(),
  buildRow: vi.fn(),
  ensureTab: vi.fn(),
  appendRows: vi.fn(),
  updateHeaderRow: vi.fn(),
}))

vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({ from: H.from }) }))
vi.mock('./oauth', () => ({ getValidAccessToken: H.token }))
vi.mock('./row-builder', () => ({ buildRowForEvent: H.buildRow }))
vi.mock('./api', () => ({ ensureTab: H.ensureTab, appendRows: H.appendRows, updateHeaderRow: H.updateHeaderRow }))

import { dispatchToGoogleSheets } from './dispatch'

const CALLER = {} as SupabaseClient

function configReturns(config: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = []
  H.from.mockImplementation((table: string) => {
    if (table !== 'google_sheets_config') throw new Error('unexpected table ' + table)
    return {
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: config, error: null }) }) }),
      update: (patch: Record<string, unknown>) => {
        updates.push(patch)
        return { eq: () => Promise.resolve({ error: null }) }
      },
    }
  })
  return updates
}

beforeEach(() => {
  H.from.mockReset()
  H.token.mockReset().mockResolvedValue('tok')
  H.buildRow.mockReset()
  H.ensureTab.mockReset().mockResolvedValue(undefined)
  H.appendRows.mockReset().mockResolvedValue(undefined)
  H.updateHeaderRow.mockReset().mockResolvedValue(undefined)
})

const CONNECTED = {
  spreadsheet_id: 'sheet-1',
  sheet_tab: 'Ventas',
  events: ['deal.won'],
  headers_written: {},
  status: 'connected',
}

describe('dispatchToGoogleSheets — gating', () => {
  it('no-ops when there is no config', async () => {
    configReturns(null)
    await dispatchToGoogleSheets(CALLER, 'a', 'deal.won', { deal_id: 'd1' })
    expect(H.appendRows).not.toHaveBeenCalled()
  })

  it('no-ops when status is not connected', async () => {
    configReturns({ ...CONNECTED, status: 'disconnected' })
    await dispatchToGoogleSheets(CALLER, 'a', 'deal.won', { deal_id: 'd1' })
    expect(H.appendRows).not.toHaveBeenCalled()
  })

  it('no-ops when no spreadsheet is selected', async () => {
    configReturns({ ...CONNECTED, spreadsheet_id: null })
    await dispatchToGoogleSheets(CALLER, 'a', 'deal.won', { deal_id: 'd1' })
    expect(H.appendRows).not.toHaveBeenCalled()
  })

  it('no-ops when the event is not subscribed', async () => {
    configReturns({ ...CONNECTED, events: ['quote.created'] })
    await dispatchToGoogleSheets(CALLER, 'a', 'deal.won', { deal_id: 'd1' })
    expect(H.appendRows).not.toHaveBeenCalled()
  })

  it('no-ops when the row builder returns null', async () => {
    configReturns(CONNECTED)
    H.buildRow.mockResolvedValue(null)
    await dispatchToGoogleSheets(CALLER, 'a', 'deal.won', { deal_id: 'gone' })
    expect(H.appendRows).not.toHaveBeenCalled()
  })
})

describe('dispatchToGoogleSheets — append', () => {
  it('writes header + row and records the tab header on first append', async () => {
    const updates = configReturns(CONNECTED)
    H.buildRow.mockResolvedValue({ tab: 'Ventas', header: ['Evento', 'Fecha'], values: ['deal.won', 'now'] })

    await dispatchToGoogleSheets(CALLER, 'a', 'deal.won', { deal_id: 'd1' })

    expect(H.ensureTab).toHaveBeenCalledWith('tok', 'sheet-1', 'Ventas')
    expect(H.appendRows).toHaveBeenCalledWith('tok', 'sheet-1', 'Ventas', [
      ['Evento', 'Fecha'],
      ['deal.won', 'now'],
    ])
    expect(H.updateHeaderRow).not.toHaveBeenCalled()
    expect(updates.at(-1)).toMatchObject({ headers_written: { Ventas: ['Evento', 'Fecha'] } })
  })

  it('writes only the data row when the stored header still matches', async () => {
    configReturns({ ...CONNECTED, headers_written: { Ventas: ['Evento', 'Fecha'] } })
    H.buildRow.mockResolvedValue({ tab: 'Ventas', header: ['Evento', 'Fecha'], values: ['deal.won', 'now'] })

    await dispatchToGoogleSheets(CALLER, 'a', 'deal.won', { deal_id: 'd1' })

    expect(H.appendRows).toHaveBeenCalledWith('tok', 'sheet-1', 'Ventas', [['deal.won', 'now']])
    expect(H.updateHeaderRow).not.toHaveBeenCalled()
  })

  it('leaves a legacy `true` header marker untouched and only appends the row', async () => {
    const updates = configReturns({ ...CONNECTED, headers_written: { Ventas: true } })
    H.buildRow.mockResolvedValue({ tab: 'Ventas', header: ['Evento', 'Fecha'], values: ['deal.won', 'now'] })

    await dispatchToGoogleSheets(CALLER, 'a', 'deal.won', { deal_id: 'd1' })

    expect(H.appendRows).toHaveBeenCalledWith('tok', 'sheet-1', 'Ventas', [['deal.won', 'now']])
    expect(H.updateHeaderRow).not.toHaveBeenCalled()
    expect(updates.at(-1)).not.toHaveProperty('headers_written')
    expect(updates.at(-1)).toHaveProperty('last_write_at')
  })

  it('rewrites row 1 when a dynamic tab header gained a column, then appends', async () => {
    const cfg = {
      ...CONNECTED,
      events: ['contact.brief_ready'],
      sheet_tab: 'Ventas',
      headers_written: { 'Ventas - Requerimientos': ['Evento', 'Fecha', 'Cliente', 'Medidas'] },
    }
    const updates = configReturns(cfg)
    H.buildRow.mockResolvedValue({
      tab: 'Ventas - Requerimientos',
      header: ['Evento', 'Fecha', 'Cliente', 'Medidas', 'Material'],
      values: ['contact.brief_ready', 'now', 'Planta VN', '1.80 m', 'Acero'],
    })

    await dispatchToGoogleSheets(CALLER, 'a', 'contact.brief_ready', { contact_id: 'c1' })

    expect(H.updateHeaderRow).toHaveBeenCalledWith('tok', 'sheet-1', 'Ventas - Requerimientos', [
      'Evento', 'Fecha', 'Cliente', 'Medidas', 'Material',
    ])
    expect(H.appendRows).toHaveBeenCalledWith('tok', 'sheet-1', 'Ventas - Requerimientos', [
      ['contact.brief_ready', 'now', 'Planta VN', '1.80 m', 'Acero'],
    ])
    expect(updates.at(-1)).toMatchObject({
      headers_written: { 'Ventas - Requerimientos': ['Evento', 'Fecha', 'Cliente', 'Medidas', 'Material'] },
    })
  })

  it('never throws when the Sheets API fails', async () => {
    configReturns(CONNECTED)
    H.buildRow.mockResolvedValue({ tab: 'Ventas', header: ['a'], values: ['b'] })
    H.appendRows.mockRejectedValue(new Error('Sheets append failed (502)'))
    await expect(dispatchToGoogleSheets(CALLER, 'a', 'deal.won', { deal_id: 'd1' })).resolves.toBeUndefined()
  })
})
