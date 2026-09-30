import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveAudience } from './audience';

// No exclude tags → the rows path never touches the database.
const db = {} as SupabaseClient;

describe('resolveAudience (uploaded / pasted rows)', () => {
  it('normalises, de-duplicates and counts invalid numbers', async () => {
    const r = await resolveAudience(
      db,
      'acc',
      {
        source: 'rows',
        phoneColumn: 'Mobile',
        nameColumn: 'Name',
        rows: [
          { Mobile: '919812345678', Name: 'Asha', City: 'Pune' },
          { Mobile: '+91 98123 45678', Name: 'Asha again', City: 'Pune' },
          { Mobile: '12', Name: 'Bad', City: 'X' },
          { Mobile: '0044 7700 900123', Name: 'Ben', City: 'London' },
        ],
      },
      ['City']
    );
    expect(r).toMatchObject({
      total: 4,
      invalid: 1,
      duplicates: 1,
      excluded: 0,
    });
    expect(r.recipients).toEqual([
      {
        phone: '919812345678',
        contactId: null,
        name: 'Asha',
        data: { City: 'Pune' },
      },
      {
        phone: '447700900123',
        contactId: null,
        name: 'Ben',
        data: { City: 'London' },
      },
    ]);
  });
});
