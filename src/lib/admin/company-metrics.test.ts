import { describe, expect, it } from 'vitest';
import { computeCompanyHandoffMetrics } from './company-metrics';

describe('computeCompanyHandoffMetrics', () => {
  it('counts transfers, first human answers and pending chats', () => {
    const result = computeCompanyHandoffMetrics(
      [
        { id: 'a', ai_handoff_at: '2026-08-01T10:00:00Z' },
        { id: 'b', ai_handoff_at: '2026-08-01T11:00:00Z' },
      ],
      [
        { conversation_id: 'a', created_at: '2026-08-01T10:05:00Z' },
        { conversation_id: 'a', created_at: '2026-08-01T10:10:00Z' },
      ]
    );
    expect(result).toEqual({
      transferred: 2,
      attended: 1,
      pending: 1,
      avgResponseMinutes: 5,
    });
  });

  it('ignores replies that happened before the handoff', () => {
    const result = computeCompanyHandoffMetrics(
      [{ id: 'a', ai_handoff_at: '2026-08-01T10:00:00Z' }],
      [{ conversation_id: 'a', created_at: '2026-08-01T09:59:00Z' }]
    );
    expect(result.attended).toBe(0);
    expect(result.pending).toBe(1);
    expect(result.avgResponseMinutes).toBeNull();
  });
});
