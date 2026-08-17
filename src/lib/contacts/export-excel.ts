import ExcelJS from 'exceljs'
import type { Contact } from '@/types'

// Fixed English labels, same convention as src/lib/kpis/export-excel.ts —
// this module is a plain function, not a component, and the app has no
// Spanish locale package yet (only en/ko).

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } }

export interface ContactExportRow {
  name: string
  phone: string
  email: string
  company: string
  temperature: string
  /** Tag names, joined with ", " — empty string if none. */
  tags: string
  createdAt: string
}

/** Shapes a raw contact + its resolved tag names into the row the
 *  export sheet writes — kept separate from the Supabase query so the
 *  "Contacts" list page (the only caller) stays the single place that
 *  knows how to fetch the current search/tag-filtered set. */
export function toContactExportRow(contact: Contact, tagNames: string[]): ContactExportRow {
  return {
    name: contact.name ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
    company: contact.company ?? '',
    temperature: contact.lead_temperature ?? '',
    tags: tagNames.join(', '),
    createdAt: contact.created_at,
  }
}

/** Builds the contacts workbook — a single sheet, one row per contact
 *  in whatever set the caller already resolved (search + tag filters
 *  applied). Pure data shaping only, so it's unit-testable without a
 *  DOM; `downloadContactsExcel` below owns the browser-download side
 *  effect. */
export function buildContactsWorkbook(rows: ContactExportRow[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Chat Sandía'
  wb.created = new Date()

  const sheet = wb.addWorksheet('Contacts')
  sheet.columns = [
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'Company', key: 'company', width: 20 },
    { header: 'Temperature', key: 'temperature', width: 14 },
    { header: 'Tags', key: 'tags', width: 28 },
    { header: 'Created', key: 'created', width: 14 },
  ]
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: 'middle' }
  })

  for (const row of rows) {
    sheet.addRow({
      name: row.name,
      phone: row.phone,
      email: row.email,
      company: row.company,
      temperature: row.temperature,
      tags: row.tags,
      created: new Date(row.createdAt).toLocaleDateString('en-US'),
    })
  }

  return wb
}

/** Builds the workbook and triggers a browser download — the only
 *  function in this module that touches the DOM. */
export async function downloadContactsExcel(rows: ContactExportRow[]): Promise<void> {
  const wb = buildContactsWorkbook(rows)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'contacts.xlsx'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
