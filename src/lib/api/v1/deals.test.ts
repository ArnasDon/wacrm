import { describe, it, expect } from 'vitest';

import { serializeDeal, parseDealFields, DealError } from './deals';

describe('serializeDeal', () => {
  it('projects a full row and defaults a missing updated_at to created_at', () => {
    const row = {
      id: 'd1',
      pipeline_id: 'p1',
      stage_id: 's1',
      contact_id: 'c1',
      conversation_id: 'conv1',
      assigned_to: 'u1',
      title: 'Acme renewal',
      value: '1200.50',
      currency: 'USD',
      notes: 'call back Friday',
      expected_close_date: '2026-09-01',
      status: 'open',
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(serializeDeal(row)).toEqual({
      id: 'd1',
      pipeline_id: 'p1',
      stage_id: 's1',
      contact_id: 'c1',
      conversation_id: 'conv1',
      assigned_to: 'u1',
      title: 'Acme renewal',
      value: 1200.5,
      currency: 'USD',
      notes: 'call back Friday',
      expected_close_date: '2026-09-01',
      status: 'open',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
  });

  it('nulls a deleted contact and a never-set assignee/notes/close-date', () => {
    const row = {
      id: 'd2',
      pipeline_id: 'p1',
      stage_id: 's1',
      contact_id: null,
      conversation_id: null,
      assigned_to: null,
      title: 'Untitled',
      value: 0,
      currency: null,
      notes: null,
      expected_close_date: null,
      status: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    const out = serializeDeal(row);
    expect(out.contact_id).toBeNull();
    expect(out.assigned_to).toBeNull();
    expect(out.currency).toBe('USD'); // falls back to DEFAULT_CURRENCY
    expect(out.status).toBe('open'); // falls back to 'open'
    expect(out.updated_at).toBe('2026-01-02T00:00:00Z');
  });
});

describe('parseDealFields', () => {
  describe('title', () => {
    it('requires a non-blank title on create', () => {
      expect(() => parseDealFields({}, { requireTitle: true })).toThrow(DealError);
      expect(() => parseDealFields({ title: '   ' }, { requireTitle: true })).toThrow(
        DealError
      );
    });

    it('trims a valid title', () => {
      expect(
        parseDealFields({ title: '  Acme deal  ' }, { requireTitle: true }).title
      ).toBe('Acme deal');
    });

    it('rejects an over-long title', () => {
      expect(() =>
        parseDealFields({ title: 'x'.repeat(201) }, { requireTitle: true })
      ).toThrow(DealError);
    });

    it('is optional on patch and omitted means untouched', () => {
      const out = parseDealFields({ value: 10 }, { requireTitle: false });
      expect(out.title).toBeUndefined();
    });

    it('still validates a present-but-blank title on patch', () => {
      expect(() => parseDealFields({ title: '' }, { requireTitle: false })).toThrow(
        DealError
      );
    });
  });

  describe('value', () => {
    it('accepts a non-negative number', () => {
      expect(
        parseDealFields({ title: 'x', value: 0 }, { requireTitle: true }).value
      ).toBe(0);
    });

    it('rejects a negative, non-finite, or non-number value', () => {
      for (const bad of [-1, NaN, Infinity, '100']) {
        expect(() =>
          parseDealFields({ title: 'x', value: bad }, { requireTitle: true })
        ).toThrow(DealError);
      }
    });
  });

  describe('currency', () => {
    it('uppercases a valid 3-letter code', () => {
      expect(
        parseDealFields({ title: 'x', currency: 'usd' }, { requireTitle: true })
          .currency
      ).toBe('USD');
    });

    it('rejects a malformed code', () => {
      for (const bad of ['US', 'USDX', 12, '']) {
        expect(() =>
          parseDealFields({ title: 'x', currency: bad }, { requireTitle: true })
        ).toThrow(DealError);
      }
    });
  });

  describe('contact_id / assigned_to', () => {
    it('accepts a string or explicit null', () => {
      const out = parseDealFields(
        { title: 'x', contact_id: 'c1', assigned_to: null },
        { requireTitle: true }
      );
      expect(out.contact_id).toBe('c1');
      expect(out.assigned_to).toBeNull();
    });

    it('rejects a non-string, non-null value', () => {
      expect(() =>
        parseDealFields({ title: 'x', contact_id: 42 }, { requireTitle: true })
      ).toThrow(DealError);
      expect(() =>
        parseDealFields({ title: 'x', assigned_to: 42 }, { requireTitle: true })
      ).toThrow(DealError);
    });
  });

  describe('notes', () => {
    it('trims a string and allows null', () => {
      expect(
        parseDealFields({ title: 'x', notes: '  hi  ' }, { requireTitle: true }).notes
      ).toBe('hi');
      expect(
        parseDealFields({ title: 'x', notes: null }, { requireTitle: true }).notes
      ).toBeNull();
    });

    it('rejects an over-long note', () => {
      expect(() =>
        parseDealFields({ title: 'x', notes: 'x'.repeat(5001) }, { requireTitle: true })
      ).toThrow(DealError);
    });
  });

  describe('expected_close_date', () => {
    it('accepts a YYYY-MM-DD string or null', () => {
      expect(
        parseDealFields(
          { title: 'x', expected_close_date: '2026-09-01' },
          { requireTitle: true }
        ).expected_close_date
      ).toBe('2026-09-01');
      expect(
        parseDealFields(
          { title: 'x', expected_close_date: null },
          { requireTitle: true }
        ).expected_close_date
      ).toBeNull();
    });

    it('rejects a non-ISO-date string', () => {
      for (const bad of ['09/01/2026', '2026-09-01T00:00:00Z', 'soon']) {
        expect(() =>
          parseDealFields(
            { title: 'x', expected_close_date: bad },
            { requireTitle: true }
          )
        ).toThrow(DealError);
      }
    });
  });

  describe('status', () => {
    it('accepts each known status', () => {
      for (const status of ['open', 'won', 'lost']) {
        expect(
          parseDealFields({ title: 'x', status }, { requireTitle: true }).status
        ).toBe(status);
      }
    });

    it('rejects an unknown status', () => {
      expect(() =>
        parseDealFields({ title: 'x', status: 'archived' }, { requireTitle: true })
      ).toThrow(DealError);
    });
  });

  it('omits every key the caller never sent, on a patch', () => {
    expect(parseDealFields({}, { requireTitle: false })).toEqual({});
  });
});
