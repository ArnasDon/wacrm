import ExcelJS from 'exceljs'
import { formatBucketLabel, formatDateRangeLabel, type BucketGranularity } from '@/lib/dashboard/date-utils'
import {
  cac,
  conversionRate,
  countQualifiedLeads,
  leadsSeries,
  qualifiedLeadsSeries,
  wonDealsSeries,
} from './compute'
import type { ContactExportRow, KpiDataset } from './types'

// Fixed English labels (not routed through next-intl) — this module
// is a plain function, not a component, and the rest of the app has
// no Spanish locale package yet (only en/ko); the on-screen KPIs page
// itself is fully translated, this only covers the exported file's
// own text.

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } }

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: 'middle' }
  })
}

/**
 * Builds the full KPI workbook — a "Summary" sheet (the 4 headline
 * numbers + their period-over-period change) plus one sheet per
 * underlying dataset, so the professional-looking charts on the page
 * are backed by real, inspectable rows in the export too. Pure data
 * shaping only — `downloadKpiExcel` below owns the actual
 * browser-download side effect, so this function stays unit-testable
 * without a DOM.
 */
export async function buildKpiWorkbook(
  data: KpiDataset,
  currency: string,
  granularity: BucketGranularity,
  contacts: ContactExportRow[],
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Chat Sandía'
  wb.created = new Date()

  const leadsCount = data.leads.length
  const qualifiedCount = countQualifiedLeads(data.leads)
  const wonCount = data.wonDeals.length
  const rate = conversionRate(wonCount, leadsCount)
  const spend = data.currentPeriodSpend?.amount ?? null
  const cacValue = spend != null ? cac(spend, wonCount) : null

  // --- Summary -----------------------------------------------------
  const summary = wb.addWorksheet('Summary')
  summary.columns = [
    { header: 'KPI', key: 'kpi', width: 34 },
    { header: 'Current value', key: 'current', width: 18 },
    { header: 'Previous period', key: 'previous', width: 18 },
  ]
  styleHeaderRow(summary.getRow(1))
  summary.addRow({ kpi: 'Period', current: formatDateRangeLabel(data.window.start, data.window.end), previous: '' })
  summary.addRow({ kpi: 'Leads generated', current: leadsCount, previous: data.previousLeadsCount })
  summary.addRow({ kpi: 'Qualified leads', current: qualifiedCount, previous: '' })
  summary.addRow({
    kpi: 'Conversion / closing rate',
    current: rate == null ? 'N/A' : `${rate.toFixed(1)}%`,
    previous: '',
  })
  summary.addRow({
    kpi: 'Customer Acquisition Cost (CAC)',
    current: cacValue == null ? 'N/A — enter spend for this period' : `${currency} ${cacValue.toFixed(2)}`,
    previous: '',
  })
  summary.addRow({ kpi: 'Deals won', current: wonCount, previous: data.previousWonCount })

  // --- Contacts ------------------------------------------------------
  // Raw per-person detail behind "Leads generated" — every contact who
  // wrote in during the period, with what an agent needs to follow up:
  // name, phone, which channel they came in on, whatever notes were
  // logged on them (closest thing to a "reason for inquiry" — there's
  // no dedicated field for it), and where their pipeline left off.
  const contactsSheet = wb.addWorksheet('Contacts')
  contactsSheet.columns = [
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Channel', key: 'channel', width: 12 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Notes', key: 'notes', width: 40 },
    { header: 'Stage', key: 'stage', width: 20 },
  ]
  styleHeaderRow(contactsSheet.getRow(1))
  for (const contact of contacts) {
    contactsSheet.addRow({
      name: contact.name,
      phone: contact.phone ?? '',
      channel: contact.channel,
      date: new Date(contact.createdAt).toLocaleDateString('en-US'),
      notes: contact.notes,
      stage: contact.stage ?? '',
    })
  }

  // --- Leads generated ----------------------------------------------
  const leadsSheet = wb.addWorksheet('Leads generated')
  leadsSheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Leads generated', key: 'count', width: 18 },
  ]
  styleHeaderRow(leadsSheet.getRow(1))
  for (const point of leadsSeries(data.leads, data.window, granularity)) {
    leadsSheet.addRow({ date: formatBucketLabel(point.key, granularity), count: point.value })
  }

  // --- Qualified leads ---------------------------------------------
  const qualifiedSheet = wb.addWorksheet('Qualified leads')
  qualifiedSheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Qualified leads (warm/hot)', key: 'count', width: 26 },
  ]
  styleHeaderRow(qualifiedSheet.getRow(1))
  for (const point of qualifiedLeadsSeries(data.leads, data.window, granularity)) {
    qualifiedSheet.addRow({ date: formatBucketLabel(point.key, granularity), count: point.value })
  }

  // --- Deals won --------------------------------------------------
  const wonSheet = wb.addWorksheet('Deals won')
  wonSheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Deals won', key: 'count', width: 18 },
  ]
  styleHeaderRow(wonSheet.getRow(1))
  for (const point of wonDealsSeries(data.wonDeals, data.window, granularity)) {
    wonSheet.addRow({ date: formatBucketLabel(point.key, granularity), count: point.value })
  }

  // --- Lead temperature distribution --------------------------------
  const tempSheet = wb.addWorksheet('Lead temperature')
  tempSheet.columns = [
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Count', key: 'count', width: 14 },
  ]
  styleHeaderRow(tempSheet.getRow(1))
  tempSheet.addRow({ category: 'Hot', count: data.temperature.hot })
  tempSheet.addRow({ category: 'Warm', count: data.temperature.warm })
  tempSheet.addRow({ category: 'Cold', count: data.temperature.cold })
  tempSheet.addRow({ category: 'Unclassified', count: data.temperature.unclassified })

  // --- CAC history -------------------------------------------------
  const cacSheet = wb.addWorksheet('CAC history')
  cacSheet.columns = [
    { header: 'Period', key: 'period', width: 26 },
    { header: 'Spend', key: 'spend', width: 14 },
    { header: 'Currency', key: 'currency', width: 10 },
  ]
  styleHeaderRow(cacSheet.getRow(1))
  for (const entry of data.spendHistory) {
    cacSheet.addRow({
      period: `${entry.period_start} – ${entry.period_end}`,
      spend: entry.amount,
      currency: entry.currency,
    })
  }

  return wb
}

/** Builds the workbook and triggers a browser download — the only
 *  function in this module that touches the DOM, kept separate so
 *  `buildKpiWorkbook` stays testable without one. */
export async function downloadKpiExcel(
  data: KpiDataset,
  currency: string,
  granularity: BucketGranularity,
  contacts: ContactExportRow[],
): Promise<void> {
  const wb = await buildKpiWorkbook(data, currency, granularity, contacts)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const rangeLabel = formatDateRangeLabel(data.window.start, data.window.end).replace(/[^\w]+/g, '-')
  a.download = `kpis-${rangeLabel}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
