import { describe, expect, it } from 'vitest';
import { isExpiredStorageObject } from './retention';

const cutoff = new Date('2026-08-01T00:00:00.000Z');

describe('isExpiredStorageObject', () => {
  it('accepts objects created before the cutoff', () => {
    expect(
      isExpiredStorageObject(
        { name: 'old', created_at: '2026-07-01T00:00:00Z' },
        cutoff
      )
    ).toBe(true);
  });

  it('keeps recent and undated objects', () => {
    expect(
      isExpiredStorageObject(
        { name: 'new', created_at: '2026-08-02T00:00:00Z' },
        cutoff
      )
    ).toBe(false);
    expect(isExpiredStorageObject({ name: 'unknown' }, cutoff)).toBe(false);
  });

  it('falls back to updated_at', () => {
    expect(
      isExpiredStorageObject(
        { name: 'old', updated_at: '2026-07-01T00:00:00Z' },
        cutoff
      )
    ).toBe(true);
  });
});
