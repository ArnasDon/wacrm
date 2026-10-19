import { describe, expect, it } from 'vitest';
import { parseBroadcastCsv } from './broadcast-csv';

describe('parseBroadcastCsv', () => {
  it('parses phone + name into the audience shape', () => {
    const result = parseBroadcastCsv(
      `phone,name
+15551230000,Ada
+15559990000,Grace`
    );

    expect(result).toEqual({
      ok: true,
      duplicates: 0,
      invalid: 0,
      contacts: [
        { phone: '+15551230000', name: 'Ada' },
        { phone: '+15559990000', name: 'Grace' },
      ],
    });
  });

  it('omits name when the column is absent', () => {
    const result = parseBroadcastCsv(`phone\n+15551230000`);
    expect(result).toEqual({
      ok: true,
      duplicates: 0,
      invalid: 0,
      contacts: [{ phone: '+15551230000' }],
    });
  });

  it('drops the extra columns the importer understands', () => {
    const result = parseBroadcastCsv(
      `phone,name,email,company,tags
+15551230000,Ada,ada@example.com,Analytical Engines,"VIP, Lead"`
    );
    expect(result).toEqual({
      ok: true,
      duplicates: 0,
      invalid: 0,
      contacts: [{ phone: '+15551230000', name: 'Ada' }],
    });
  });

  it('tolerates any column order', () => {
    const result = parseBroadcastCsv(`name,phone\nAda,+15551230000`);
    expect(result).toEqual({
      ok: true,
      duplicates: 0,
      invalid: 0,
      contacts: [{ phone: '+15551230000', name: 'Ada' }],
    });
  });

  // The downstream upsert inserts against UNIQUE (account_id,
  // phone_normalized) (migration 022). If two spellings of one number
  // both reached it, the whole broadcast would die on a 23505 — so
  // collapsing them here is the fix, not a nicety.
  it('collapses differently-formatted spellings of the same number', () => {
    const result = parseBroadcastCsv(
      `phone,name
+1 (555) 123-0000,Ada
+1-555-123-0000,Ada Again`
    );

    expect(result).toEqual({
      ok: true,
      duplicates: 1,
      invalid: 0,
      contacts: [{ phone: '+1 (555) 123-0000', name: 'Ada' }],
    });
  });

  // A national-format number has no country code, so Meta reads its
  // leading digits as one: "4155551212" (US) is delivered to +41
  // (Switzerland). Rows without a leading `+` are refused and counted,
  // not silently dropped, so a whole-file export from a spreadsheet that
  // stripped the `+` is visible to the user before anything is sent
  // (issue #586).
  it('rejects rows without a leading + and reports them as invalid', () => {
    const result = parseBroadcastCsv(
      `phone,name
4155551212,National US
+14155551212,Ada
9876543210,National IN`
    );

    expect(result).toEqual({
      ok: true,
      duplicates: 0,
      invalid: 2,
      contacts: [{ phone: '+14155551212', name: 'Ada' }],
    });
  });

  it('reports no_valid_rows when every number lacks a country code', () => {
    expect(parseBroadcastCsv(`phone,name\n4155551212,Ada`)).toEqual({
      ok: false,
      error: 'no_valid_rows',
    });
  });

  it('reports a missing phone header distinctly from an empty file', () => {
    expect(parseBroadcastCsv(`name,email\nAda,ada@example.com`)).toEqual({
      ok: false,
      error: 'missing_phone_column',
    });
    // No header at all reads the same way — there is no `phone` column.
    expect(parseBroadcastCsv('')).toEqual({
      ok: false,
      error: 'missing_phone_column',
    });
  });

  it('reports no_valid_rows when the header is good but no number is', () => {
    expect(parseBroadcastCsv(`phone,name\n,Ada\n"",Grace`)).toEqual({
      ok: false,
      error: 'no_valid_rows',
    });
  });

  it('handles CRLF line endings and a trailing newline', () => {
    const result = parseBroadcastCsv(
      'phone,name\r\n+15551230000,Ada\r\n+15559990000,Grace\r\n'
    );
    expect(result).toEqual({
      ok: true,
      duplicates: 0,
      invalid: 0,
      contacts: [
        { phone: '+15551230000', name: 'Ada' },
        { phone: '+15559990000', name: 'Grace' },
      ],
    });
  });
});
