import { describe, it, expect } from 'vitest'
import { buildContactsWorkbook, toContactExportRow, type ContactExportRow } from './export-excel'
import type { Contact } from '@/types'

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    user_id: 'u1',
    account_id: 'a1',
    phone: '+15551234567',
    name: 'Jane Doe',
    email: 'jane@example.com',
    company: 'Acme',
    lead_temperature: 'hot',
    created_at: '2026-08-01T10:00:00',
    updated_at: '2026-08-01T10:00:00',
    ...overrides,
  }
}

describe('toContactExportRow', () => {
  it('joins tag names and falls back to empty strings for missing fields', () => {
    const row = toContactExportRow(makeContact(), ['VIP', 'Newsletter'])
    expect(row).toEqual({
      name: 'Jane Doe',
      phone: '+15551234567',
      email: 'jane@example.com',
      company: 'Acme',
      temperature: 'hot',
      tags: 'VIP, Newsletter',
      createdAt: '2026-08-01T10:00:00',
    })
  })

  it('handles a contact with no name, email, company, temperature, or tags', () => {
    const row = toContactExportRow(
      makeContact({ name: undefined, email: undefined, company: undefined, lead_temperature: null }),
      [],
    )
    expect(row).toEqual({
      name: '',
      phone: '+15551234567',
      email: '',
      company: '',
      temperature: '',
      tags: '',
      createdAt: '2026-08-01T10:00:00',
    })
  })
})

describe('buildContactsWorkbook', () => {
  const rows: ContactExportRow[] = [
    {
      name: 'Jane Doe',
      phone: '+15551234567',
      email: 'jane@example.com',
      company: 'Acme',
      temperature: 'hot',
      tags: 'VIP',
      createdAt: '2026-08-01T10:00:00',
    },
    {
      name: '',
      phone: '',
      email: '',
      company: '',
      temperature: '',
      tags: '',
      createdAt: '2026-08-02T10:00:00',
    },
  ]

  it('writes one row per contact into a single Contacts sheet', () => {
    const wb = buildContactsWorkbook(rows)
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Contacts'])
    const sheet = wb.getWorksheet('Contacts')!
    expect(sheet.rowCount).toBe(3) // header + 2 contacts
    const sheetRows = sheet.getSheetValues() as unknown[][]
    const jane = sheetRows.find((r) => r?.[1] === 'Jane Doe')
    expect(jane).toEqual([undefined, 'Jane Doe', '+15551234567', 'jane@example.com', 'Acme', 'hot', 'VIP', expect.any(String)])
  })

  it('serializes to a real xlsx buffer', async () => {
    const wb = buildContactsWorkbook(rows)
    const buffer = await wb.xlsx.writeBuffer()
    expect(buffer.byteLength).toBeGreaterThan(0)
  })
})
