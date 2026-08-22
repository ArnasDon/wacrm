import { describe, expect, it } from 'vitest';
import {
  splitIntoLotes,
  randomAttemptDelayMs,
  isLote2Blocked,
  estimateRemainingMs,
  MIN_ATTEMPT_DELAY_MS,
  MAX_ATTEMPT_DELAY_MS,
} from './lote-engine';

describe('splitIntoLotes', () => {
  it('splits an even count evenly', () => {
    expect(splitIntoLotes(74)).toEqual([37, 37]);
  });

  it('rounds the first lote down on an odd count', () => {
    expect(splitIntoLotes(73)).toEqual([36, 37]);
  });

  it('handles zero leads', () => {
    expect(splitIntoLotes(0)).toEqual([0, 0]);
  });

  it('keeps a single lead in one lote instead of splitting (no empty lote 1)', () => {
    expect(splitIntoLotes(1)).toEqual([1, 0]);
  });

  it('keeps small lists (2-3 leads) in a single lote rather than an under-min split', () => {
    expect(splitIntoLotes(2)).toEqual([2, 0]);
    expect(splitIntoLotes(3)).toEqual([3, 0]);
  });

  it('splits once both lotes would reach the minimum size', () => {
    expect(splitIntoLotes(4)).toEqual([2, 2]);
    expect(splitIntoLotes(5)).toEqual([2, 3]);
  });

  it('never returns a split where one side is 0 for a total that can split', () => {
    for (const total of [4, 5, 10, 11, 100, 101, 9999]) {
      const [a, b] = splitIntoLotes(total);
      expect(a).toBeGreaterThan(0);
      expect(b).toBeGreaterThan(0);
    }
  });

  it('always sums back to the total', () => {
    for (const total of [0, 1, 2, 3, 4, 5, 10, 11, 100, 101, 9999]) {
      const [a, b] = splitIntoLotes(total);
      expect(a + b).toBe(total);
    }
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

describe('isLote2Blocked', () => {
  it('blocks lote 2 while lote 1 is not concluido', () => {
    expect(isLote2Blocked('aguardando')).toBe(true);
    expect(isLote2Blocked('em_andamento')).toBe(true);
    expect(isLote2Blocked('pausado')).toBe(true);
  });

  it('unblocks lote 2 once lote 1 is concluido', () => {
    expect(isLote2Blocked('concluido')).toBe(false);
  });
});
