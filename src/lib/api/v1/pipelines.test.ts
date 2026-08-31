import { describe, it, expect } from 'vitest';

import { serializePipeline } from './pipelines';

describe('serializePipeline', () => {
  it('sorts embedded stages by position and drops internal fields', () => {
    const row = {
      id: 'p1',
      user_id: 'internal-user',
      account_id: 'internal-acct',
      name: 'Sales Pipeline',
      created_at: '2026-01-01T00:00:00Z',
      pipeline_stages: [
        { id: 's3', name: 'Won', position: 2, color: '#22c55e' },
        { id: 's1', name: 'New Lead', position: 0, color: '#3b82f6' },
        { id: 's2', name: 'Qualified', position: 1, color: '#eab308' },
      ],
    };
    const out = serializePipeline(row);
    expect(out).not.toHaveProperty('user_id');
    expect(out).not.toHaveProperty('account_id');
    expect(out.stages.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });

  it('tolerates a pipeline with no stages embed', () => {
    const row = {
      id: 'p2',
      name: 'Empty',
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(serializePipeline(row).stages).toEqual([]);
  });
});
