import { describe, expect, it } from 'vitest';

import {
  assignPairs,
  buildPairs,
  channelTotals,
  planDistribution,
} from './distribution';

const A = { name: 'a', language: 'en' };
const B = { name: 'b', language: 'en' };

// c1 has templates a+b, c2 only a.
const pairs = buildPairs(['c1', 'c2'], { c1: [A, B], c2: [A] });
const counts = (mode: 'channel' | 'template' | 'matrix', n: number) =>
  planDistribution(pairs, mode, n).map(
    (p) => `${p.channelId}/${p.template.name}=${p.count}`
  );

describe('planDistribution', () => {
  it('by channel: each channel half, split among its templates', () => {
    expect(counts('channel', 100)).toEqual(['c1/a=25', 'c1/b=25', 'c2/a=50']);
  });

  it('by template: each template half, split among channels that have it', () => {
    expect(counts('template', 100)).toEqual(['c1/a=25', 'c1/b=50', 'c2/a=25']);
  });

  it('matrix: every pair equal', () => {
    expect(counts('matrix', 99)).toEqual(['c1/a=33', 'c1/b=33', 'c2/a=33']);
  });

  it('always sums to the total (largest remainder)', () => {
    for (const n of [0, 1, 2, 7, 1001, 5006]) {
      for (const mode of ['channel', 'template', 'matrix'] as const) {
        expect(
          planDistribution(pairs, mode, n).reduce((a, p) => a + p.count, 0)
        ).toBe(n);
      }
    }
  });

  it('three channels split 5 006 as 1 669 / 1 669 / 1 668', () => {
    const p3 = buildPairs(['x', 'y', 'z'], { x: [A], y: [A], z: [A] });
    expect(planDistribution(p3, 'channel', 5006).map((p) => p.count)).toEqual([
      1669, 1669, 1668,
    ]);
  });
});

describe('assignPairs', () => {
  it('assigns exactly the planned counts, interleaved', () => {
    const plan = planDistribution(pairs, 'channel', 8);
    const seq = assignPairs(plan);
    expect(seq).toHaveLength(8);
    const got = new Map<string, number>();
    for (const s of seq)
      got.set(
        `${s.channelId}/${s.key}`,
        (got.get(`${s.channelId}/${s.key}`) ?? 0) + 1
      );
    expect(Object.fromEntries(got)).toEqual({
      'c1/a:en': 2,
      'c1/b:en': 2,
      'c2/a:en': 4,
    });
    // The first half already contains every pair (not all of c1 first).
    expect(new Set(seq.slice(0, 4).map((s) => s.channelId))).toEqual(
      new Set(['c1', 'c2'])
    );
  });

  it('channel totals feed the split cards', () => {
    const totals = channelTotals(planDistribution(pairs, 'channel', 100));
    expect(totals.get('c1')).toEqual({ receivers: 50, templates: 2 });
    expect(totals.get('c2')).toEqual({ receivers: 50, templates: 1 });
  });
});
