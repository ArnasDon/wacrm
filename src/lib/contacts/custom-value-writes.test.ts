import { describe, expect, it } from 'vitest';
import { planCustomValueWrites } from './custom-value-writes';

describe('planCustomValueWrites', () => {
  it('upserts filled values trimmed and clears blank ones', () => {
    expect(
      planCustomValueWrites('c1', { f1: '  Gold ', f2: '   ', f3: '' })
    ).toEqual({
      upserts: [{ contact_id: 'c1', custom_field_id: 'f1', value: 'Gold' }],
      clearedFieldIds: ['f2', 'f3'],
    });
  });

  it('plans nothing for an empty form', () => {
    expect(planCustomValueWrites('c1', {})).toEqual({
      upserts: [],
      clearedFieldIds: [],
    });
  });
});
