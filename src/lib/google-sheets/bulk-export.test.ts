import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { exportEntity, isExportEntity, MAX_EXPORT_ROWS } from './bulk-export'

function makeDb(rowsByTable: Record<string, Record<string, unknown>[]>): SupabaseClient {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: rowsByTable[table] ?? [], error: null }),
      }
      return chain
    },
  } as unknown as SupabaseClient
}

describe('isExportEntity', () => {
  it('accepts the four known entities and rejects anything else', () => {
    expect(isExportEntity('deals')).toBe(true)
    expect(isExportEntity('contacts')).toBe(true)
    expect(isExportEntity('messages')).toBe(false)
    expect(isExportEntity(42)).toBe(false)
  })
})

describe('exportEntity', () => {
  it('shapes contacts into a header + rows, header first', async () => {
    const db = makeDb({
      contacts: [
        { name: 'Ana', phone: '502111', email: 'a@x.com', company: 'ACME', lead_temperature: 'hot', created_at: '2026-08-01' },
        { name: 'Beto', phone: '502222', email: null, company: null, lead_temperature: null, created_at: '2026-08-02' },
      ],
    })
    const res = await exportEntity(db, 'acct-1', 'contacts')
    expect(res.tab).toBe('Export Contactos')
    expect(res.header[0]).toBe('Nombre')
    expect(res.rows[0]).toEqual(res.header) // header row prepended
    expect(res.rows).toHaveLength(3) // header + 2
    expect(res.rows[1]).toEqual(['Ana', '502111', 'a@x.com', 'ACME', 'hot', '2026-08-01'])
    expect(res.rows[2][2]).toBe('') // null email -> ''
    expect(res.rowCount).toBe(2)
    expect(res.truncated).toBe(false)
  })

  it('flattens the joined contact + stage on a deals export', async () => {
    const db = makeDb({
      deals: [
        {
          title: 'Camisa x100', value: 1500, currency: 'GTQ', status: 'won', won_at: '2026-08-10',
          created_at: '2026-08-01', contacts: { name: 'Ana', phone: '502111' }, pipeline_stages: { name: 'Cerrada' },
        },
      ],
    })
    const res = await exportEntity(db, 'acct-1', 'deals')
    expect(res.tab).toBe('Export Negociaciones')
    expect(res.rows[1]).toEqual(['Camisa x100', 1500, 'GTQ', 'Cerrada', 'won', '2026-08-10', 'Ana', '502111', '2026-08-01'])
  })

  it('marks truncated when the source has more than MAX_EXPORT_ROWS', async () => {
    const many = Array.from({ length: MAX_EXPORT_ROWS + 5 }, (_, i) => ({
      name: `c${i}`, phone: '', email: null, company: null, lead_temperature: null, created_at: '2026-08-01',
    }))
    const db = makeDb({ contacts: many })
    const res = await exportEntity(db, 'acct-1', 'contacts')
    expect(res.truncated).toBe(true)
    expect(res.rowCount).toBe(MAX_EXPORT_ROWS)
    expect(res.rows).toHaveLength(MAX_EXPORT_ROWS + 1) // + header
  })
})
