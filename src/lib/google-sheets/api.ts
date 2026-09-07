import { googleFetch, GoogleSheetsError } from './oauth'

// ============================================================
// Thin wrapper over the Google Sheets REST API v4. Every call takes a
// plaintext access token from `getValidAccessToken` — nothing here
// reads the config table or refreshes tokens.
// ============================================================

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

/** Fetch a spreadsheet's title + tab names — used once when the
 *  operator picks a target sheet, to confirm it's reachable and show a
 *  friendly name in Settings. */
export async function getSpreadsheetMeta(
  accessToken: string,
  spreadsheetId: string,
): Promise<{ title: string; tabs: string[] }> {
  const res = await googleFetch(
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 404) {
      throw new GoogleSheetsError('That spreadsheet was not found, or the connected Google account cannot open it.', 404)
    }
    throw new GoogleSheetsError(`Google Sheets API error (${res.status}): ${body.slice(0, 300)}`, 502)
  }
  const data = (await res.json()) as {
    properties?: { title?: string }
    sheets?: { properties?: { title?: string } }[]
  }
  return {
    title: data.properties?.title ?? 'Untitled',
    tabs: (data.sheets ?? []).map((s) => s.properties?.title ?? '').filter(Boolean),
  }
}

/** Create a tab if it doesn't already exist. No-op when it does. */
export async function ensureTab(
  accessToken: string,
  spreadsheetId: string,
  tab: string,
): Promise<void> {
  const meta = await getSpreadsheetMeta(accessToken, spreadsheetId)
  if (meta.tabs.includes(tab)) return
  const res = await googleFetch(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleSheetsError(`Could not create tab "${tab}": ${body.slice(0, 300)}`, 502)
  }
}

/** Overwrite row 1 of `tab` with `header`. Used when a dynamic-column
 *  tab (the "Requerimientos" brief sheet) gains a column because the
 *  account added a custom field — the existing data rows are left
 *  untouched, only the header line is rewritten. A shorter header than
 *  before can leave stale trailing header cells; acceptable since
 *  custom fields are rarely deleted. */
export async function updateHeaderRow(
  accessToken: string,
  spreadsheetId: string,
  tab: string,
  header: (string | number | null)[],
): Promise<void> {
  const range = `${encodeURIComponent(tab)}!1:1`
  const res = await googleFetch(
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [header] }),
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleSheetsError(`Sheets header update failed (${res.status}): ${body.slice(0, 300)}`, 502)
  }
}

/** Append one or more rows to the bottom of `tab`. `values` is an
 *  array of rows; each row an array of cell values. */
/**
 * Append `values` (each an aligned row) to the bottom of `tab`. Returns
 * the A1 range Google actually wrote (e.g. `Habitaciones!A5:I6`) so the
 * caller can learn the row number of what it just appended, or `null`
 * when nothing was written.
 */
export async function appendRows(
  accessToken: string,
  spreadsheetId: string,
  tab: string,
  values: (string | number | null)[][],
): Promise<string | null> {
  if (values.length === 0) return null
  const range = `${encodeURIComponent(tab)}!A1`
  const res = await googleFetch(
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleSheetsError(`Sheets append failed (${res.status}): ${body.slice(0, 300)}`, 502)
  }
  const json = (await res.json().catch(() => null)) as
    | { updates?: { updatedRange?: string } }
    | null
  return json?.updates?.updatedRange ?? null
}

/** The last row number in an A1 range like `Habitaciones!A5:I6` → 6.
 *  `null` when it can't be parsed. */
export function lastRowOfRange(range: string | null): number | null {
  if (!range) return null
  const m = range.match(/[A-Za-z]+(\d+)(?::[A-Za-z]+(\d+))?$/)
  if (!m) return null
  return Number(m[2] ?? m[1]) || null
}

/**
 * Overwrite the first `values.length` cells of row `rowNumber` in `tab`
 * (starting at column A). Cells past `values.length` are left untouched
 * — that's how the hotel-filled "Aprobación" column survives an update.
 */
export async function writeRow(
  accessToken: string,
  spreadsheetId: string,
  tab: string,
  rowNumber: number,
  values: (string | number | null)[],
): Promise<void> {
  if (values.length === 0) return
  const range = `${encodeURIComponent(tab)}!A${rowNumber}`
  const res = await googleFetch(
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [values] }),
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleSheetsError(`Sheets row write failed (${res.status}): ${body.slice(0, 300)}`, 502)
  }
}

/** Replace a whole tab's contents with `rows` (header + data). Clears
 *  the existing range first so a smaller re-export doesn't leave stale
 *  trailing rows. Used by the Phase-2 bulk export. */
export async function clearAndWrite(
  accessToken: string,
  spreadsheetId: string,
  tab: string,
  rows: (string | number | null)[][],
): Promise<void> {
  const sid = encodeURIComponent(spreadsheetId)
  const clearRes = await googleFetch(
    `${SHEETS_BASE}/${sid}/values/${encodeURIComponent(tab)}:clear`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!clearRes.ok) {
    const body = await clearRes.text().catch(() => '')
    throw new GoogleSheetsError(`Sheets clear failed (${clearRes.status}): ${body.slice(0, 300)}`, 502)
  }
  const range = `${encodeURIComponent(tab)}!A1`
  const res = await googleFetch(
    `${SHEETS_BASE}/${sid}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleSheetsError(`Sheets write failed (${res.status}): ${body.slice(0, 300)}`, 502)
  }
}
