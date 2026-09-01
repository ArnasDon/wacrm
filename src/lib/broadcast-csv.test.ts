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
      contacts: [{ phone: '+15551230000', name: 'Ada' }],
    });
  });

  it('tolerates any column order', () => {
    const result = parseBroadcastCsv(`name,phone\nAda,+15551230000`);
    expect(result).toEqual({
      ok: true,
      duplicates: 0,
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
15551230000,Ada Again`
    );

    expect(result).toEqual({
      ok: true,
      duplicates: 1,
      contacts: [{ phone: '+1 (555) 123-0000', name: 'Ada' }],
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
      contacts: [
        { phone: '+15551230000', name: 'Ada' },
        { phone: '+15559990000', name: 'Grace' },
      ],
    });
  });
});
