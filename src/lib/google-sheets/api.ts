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

/** Append one or more rows to the bottom of `tab`. `values` is an
 *  array of rows; each row an array of cell values. */
export async function appendRows(
  accessToken: string,
  spreadsheetId: string,
  tab: string,
  values: (string | number | null)[][],
): Promise<void> {
  if (values.length === 0) return
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
