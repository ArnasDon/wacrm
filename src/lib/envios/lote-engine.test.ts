import { describe, expect, it } from 'vitest';
import {
  splitIntoLotes,
  variantIndexForPosition,
  randomAttemptDelayMs,
  isLoteBlocked,
  estimateRemainingMs,
  MIN_ATTEMPT_DELAY_MS,
  MAX_ATTEMPT_DELAY_MS,
  MAX_LOTES,
} from './lote-engine';

describe('splitIntoLotes', () => {
  it('splits an even count evenly across 2 lotes (default)', () => {
    expect(splitIntoLotes(74)).toEqual([37, 37]);
  });

  it('rounds earlier lotes down on an uneven count', () => {
    expect(splitIntoLotes(73)).toEqual([36, 37]);
  });

  it('handles zero leads', () => {
    expect(splitIntoLotes(0)).toEqual([0]);
  });

  it('keeps a single lead in one lote instead of splitting', () => {
    expect(splitIntoLotes(1, 2)).toEqual([1]);
  });

  it('keeps small lists (2-3 leads) in a single lote rather than an under-min split', () => {
    expect(splitIntoLotes(2, 2)).toEqual([2]);
    expect(splitIntoLotes(3, 2)).toEqual([3]);
  });

  it('splits once every lote would reach the minimum size', () => {
    expect(splitIntoLotes(4, 2)).toEqual([2, 2]);
    expect(splitIntoLotes(5, 2)).toEqual([2, 3]);
  });

  it('never returns a split with an empty lote for a total that can split', () => {
    for (const total of [4, 5, 10, 11, 100, 101, 9999]) {
      const sizes = splitIntoLotes(total, 2);
      expect(sizes.every((s) => s > 0)).toBe(true);
    }
  });

  it('always sums back to the total', () => {
    for (const total of [0, 1, 2, 3, 4, 5, 10, 11, 100, 101, 9999]) {
      for (const n of [1, 2, 3, 5, 10]) {
        const sizes = splitIntoLotes(total, n);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it('distributes N lotes as evenly as possible, remainder on the last lotes', () => {
    expect(splitIntoLotes(10, 3)).toEqual([3, 3, 4]);
    expect(splitIntoLotes(15, 3)).toEqual([5, 5, 5]);
    expect(splitIntoLotes(8, 4)).toEqual([2, 2, 2, 2]);
  });

  it('reduces the lote count when the total cannot support MIN_LOTE_SIZE per lote', () => {
    // 7 leads at MIN_LOTE_SIZE=2 can only support 3 non-empty lotes, not 4 or 5.
    expect(splitIntoLotes(7, 4)).toEqual([2, 2, 3]);
    expect(splitIntoLotes(7, 5)).toEqual([2, 2, 3]);
  });

  it('clamps an out-of-range lote count to [1, MAX_LOTES]', () => {
    expect(splitIntoLotes(100, 0)).toHaveLength(1);
    expect(splitIntoLotes(1000, MAX_LOTES + 50)).toHaveLength(MAX_LOTES);
  });
});

describe('variantIndexForPosition', () => {
  it('always returns 0 when there is 0 or 1 variant', () => {
    expect(variantIndexForPosition(0, 1)).toBe(0);
    expect(variantIndexForPosition(5, 1)).toBe(0);
    expect(variantIndexForPosition(5, 0)).toBe(0);
  });

  it('rotates round-robin across variants', () => {
    const variantCount = 3;
    const assigned = Array.from({ length: 9 }, (_, i) => variantIndexForPosition(i, variantCount));
    expect(assigned).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2]);
  });

  it('splits evenly for a lote whose size is a multiple of the variant count', () => {
    const variantCount = 3;
    const counts = [0, 0, 0];
    for (let i = 0; i < 15; i++) counts[variantIndexForPosition(i, variantCount)]++;
    expect(counts).toEqual([5, 5, 5]);
  });
});

describe('randomAttemptDelayMs', () => {
  it('stays within the 60-240s range', () => {
    for (let i = 0; i < 200; i++) {
      const ms = randomAttemptDelayMs();
      expect(ms).toBeGreaterThanOrEqual(MIN_ATTEMPT_DELAY_MS);
      expect(ms).toBeLessThanOrEqual(MAX_ATTEMPT_DELAY_MS);
    }
  });

  it('is not a fixed value across calls', () => {
    const samples = Array.from({ length: 20 }, () => randomAttemptDelayMs());
    const distinct = new Set(samples);
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('estimateRemainingMs', () => {
  const AVG_DELAY_MS = (MIN_ATTEMPT_DELAY_MS + MAX_ATTEMPT_DELAY_MS) / 2;
  const NOW = Date.parse('2026-08-21T12:00:00Z');

  it('returns null when nothing is left pending', () => {
    expect(
      estimateRemainingMs(
        [
          { status: 'enviado', next_attempt_at: null },
          { status: 'falhou', next_attempt_at: null },
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it('uses the known wait for the scheduled lead plus the average for every lead after it', () => {
    const scheduledFor = NOW + 90_000; // 90s from now
    const ms = estimateRemainingMs(
      [
        { status: 'enviado', next_attempt_at: null },
        { status: 'na_fila', next_attempt_at: new Date(scheduledFor).toISOString() },
        { status: 'na_fila', next_attempt_at: null },
        { status: 'na_fila', next_attempt_at: null },
      ],
      NOW,
    );
    expect(ms).toBe(90_000 + 2 * AVG_DELAY_MS);
  });

  it('falls back to a pure average estimate when no interval has been drawn yet', () => {
    const ms = estimateRemainingMs(
      [
        { status: 'na_fila', next_attempt_at: null },
        { status: 'na_fila', next_attempt_at: null },
        { status: 'na_fila', next_attempt_at: null },
      ],
      NOW,
    );
    expect(ms).toBe(3 * AVG_DELAY_MS);
  });

  it('clamps a scheduled time already in the past to zero instead of going negative', () => {
    const ms = estimateRemainingMs(
      [{ status: 'na_fila', next_attempt_at: new Date(NOW - 5_000).toISOString() }],
      NOW,
    );
    expect(ms).toBe(0);
  });

  it('ignores leads outside the queue (enviando counts as effectively immediate, not pending)', () => {
    const ms = estimateRemainingMs(
      [
        { status: 'enviando', next_attempt_at: null },
        { status: 'na_fila', next_attempt_at: null },
      ],
      NOW,
    );
    expect(ms).toBe(1 * AVG_DELAY_MS);
  });
});

describe('isLoteBlocked', () => {
  it('blocks a lote while any lower-numbered lote is not concluido', () => {
    const lotes = [{ numero_lote: 1, status: 'aguardando' }];
    expect(isLoteBlocked(2, lotes)).toBe(true);
  });

  it('unblocks a lote once every lower-numbered lote is concluido', () => {
    const lotes = [{ numero_lote: 1, status: 'concluido' }];
    expect(isLoteBlocked(2, lotes)).toBe(false);
  });

  it('never blocks lote 1 (no lower-numbered lote exists)', () => {
    expect(isLoteBlocked(1, [])).toBe(false);
  });

  it('generalizes to N lotes: lote 3 waits on both lote 1 and lote 2', () => {
    const lotes = [
      { numero_lote: 1, status: 'concluido' },
      { numero_lote: 2, status: 'em_andamento' },
    ];
    expect(isLoteBlocked(3, lotes)).toBe(true);

    const allDone = [
      { numero_lote: 1, status: 'concluido' },
      { numero_lote: 2, status: 'concluido' },
    ];
    expect(isLoteBlocked(3, allDone)).toBe(false);
  });
});
