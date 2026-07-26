import { describe, expect, it } from 'vitest';

import {
  flowAnalyticsResponseSchema,
  parseFlowAnalyticsQuery,
} from './analytics';

const uuid = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;

describe('flow analytics contracts', () => {
  it('accepts an omitted window and a strict versioned UTC interval', () => {
    expect(parseFlowAnalyticsQuery(new URLSearchParams())).toEqual({});
    expect(
      parseFlowAnalyticsQuery(
        new URLSearchParams({
          version_id: uuid('1'),
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-02-01T00:00:00.000Z',
        })
      )
    ).toEqual({
      version_id: uuid('1'),
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    });
  });

  it('rejects unknown, malformed, reversed, and overlong windows', () => {
    expect(() =>
      parseFlowAnalyticsQuery(new URLSearchParams({ extra: '1' }))
    ).toThrow();
    expect(() =>
      parseFlowAnalyticsQuery(new URLSearchParams({ version_id: 'not-a-uuid' }))
    ).toThrow();
    expect(() =>
      parseFlowAnalyticsQuery(
        new URLSearchParams({
          from: '2026-02-01T00:00:00.000Z',
          to: '2026-01-01T00:00:00.000Z',
        })
      )
    ).toThrow();
    expect(() =>
      parseFlowAnalyticsQuery(
        new URLSearchParams({
          from: '2025-01-01T00:00:00.000Z',
          to: '2026-01-02T00:00:00.001Z',
        })
      )
    ).toThrow();
  });

  it('fails closed on NaN-like rates and malformed branch rows', () => {
    const valid = {
      flow: { id: uuid('1'), name: 'Support' },
      version: { id: uuid('2'), version: 2, label: null },
      available_versions: [{ id: uuid('2'), version: 2, label: null }],
      window: {
        from: '2026-01-01T00:00:00+00:00',
        to: '2026-02-01T00:00:00+00:00',
      },
      coverage_started_at: '2026-01-15T00:00:00+00:00',
      legacy_attempts_excluded: 0,
      biggest_dropoff: null,
      nodes: [
        {
          node_key: 'start',
          node_type: 'start',
          entries: 1,
          unique_runs: 1,
          open: 0,
          resolved: 1,
          advanced: 1,
          dropoff: 0,
          completed: 0,
          handed_off: 0,
          advance_rate: 1,
          dropoff_rate: 0,
          avg_duration_ms: 10,
          avg_processing_ms: 5,
          next_nodes: [
            {
              flow_version_id: uuid('2'),
              node_key: 'end',
              count: 1,
            },
          ],
        },
      ],
    };

    expect(flowAnalyticsResponseSchema.parse(valid)).toEqual(valid);
    expect(
      flowAnalyticsResponseSchema.safeParse({
        ...valid,
        nodes: [{ ...valid.nodes[0], advance_rate: 'NaN' }],
      }).success
    ).toBe(false);
    expect(
      flowAnalyticsResponseSchema.safeParse({
        ...valid,
        nodes: [
          {
            ...valid.nodes[0],
            next_nodes: [{ node_key: 'end', count: -1 }],
          },
        ],
      }).success
    ).toBe(false);
  });
});
