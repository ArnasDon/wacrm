import { describe, expect, it } from 'vitest';
import {
  splitIntoLotes,
  randomAttemptDelayMs,
  isLote2Blocked,
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

  it('handles a single lead (all goes to lote 2)', () => {
    expect(splitIntoLotes(1)).toEqual([0, 1]);
  });

  it('always sums back to the total', () => {
    for (const total of [2, 3, 10, 11, 100, 101, 9999]) {
      const [a, b] = splitIntoLotes(total);
      expect(a + b).toBe(total);
    }
  });
});

describe('randomAttemptDelayMs', () => {
  it('stays within the 60-300s range', () => {
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
