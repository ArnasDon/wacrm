/**
 * CSV → broadcast audience.
 *
 * The standard campaign's "Upload CSV" audience needs a `{ phone, name }[]`
 * list. It reads files the same way the advanced campaign does
 * (`parseCsvTable` / `normalizeCsvPhone`), so one spreadsheet works in
 * both:
 *
 *   - any delimiter (`,` `;` tab), quoted cells, a BOM;
 *   - the phone column is found by name ("phone", "mobile", "whatsapp",
 *     "number"…), the name column likewise and optional;
 *   - numbers must carry their country code, with or without a leading
 *     `+` or `00` ("919812345678", "+91 98123 45678"). The file is the
 *     source of truth for the country code — the wizard doesn't ask.
 *
 * De-duplication happens HERE, on the normalized number, because the
 * downstream contact upsert inserts against a UNIQUE index on
 * (account_id, phone_normalized) (migration 022). Two spellings of the
 * same number in one file would otherwise reach that index as separate
 * inserts and fail the whole broadcast with a constraint error.
 *
 * Pure and unit-tested: the wizard is a client component and
 * `vitest.config.ts` runs `environment: "node"` with no jsdom.
 */

import {
  guessColumn,
  normalizeCsvPhone,
  parseCsvTable,
} from '@/lib/campaigns/advanced';

/** The shape the wizard hands to `createAndSendBroadcast`. */
export interface BroadcastCsvContact {
  /** `+` and digits, e.g. "+919812345678". */
  phone: string;
  name?: string;
}

export type BroadcastCsvError =
  /** No column that looks like a phone number — the one we can't work without. */
  | 'missing_phone_column'
  /** Header was fine, but not one row carried a usable number. */
  | 'no_valid_rows';

export type ParseBroadcastCsvResult =
  | {
      ok: true;
      contacts: BroadcastCsvContact[];
      /** Rows dropped as same-number repeats. */
      duplicates: number;
      /** Rows dropped because the number is blank or not a valid number. */
      invalid: number;
    }
  | { ok: false; error: BroadcastCsvError };

export function parseBroadcastCsv(text: string): ParseBroadcastCsvResult {
  const { headers, rows } = parseCsvTable(text);
  const phoneColumn = guessColumn(headers, 'phone');
  if (!phoneColumn) return { ok: false, error: 'missing_phone_column' };
  const phoneIdx = headers.indexOf(phoneColumn);
  const nameColumn = guessColumn(
    headers.filter((h) => h !== phoneColumn),
    'name'
  );
  const nameIdx = nameColumn ? headers.indexOf(nameColumn) : -1;

  const seen = new Set<string>();
  const contacts: BroadcastCsvContact[] = [];
  let duplicates = 0;
  let invalid = 0;
  for (const r of rows) {
    const digits = normalizeCsvPhone(r[phoneIdx] ?? '');
    if (!digits) {
      invalid++;
      continue;
    }
    if (seen.has(digits)) {
      duplicates++;
      continue;
    }
    seen.add(digits);
    const name = nameIdx >= 0 ? r[nameIdx]?.trim() : '';
    contacts.push(
      name ? { phone: `+${digits}`, name } : { phone: `+${digits}` }
    );
  }

  if (contacts.length === 0) return { ok: false, error: 'no_valid_rows' };
  return { ok: true, contacts, duplicates, invalid };
}
