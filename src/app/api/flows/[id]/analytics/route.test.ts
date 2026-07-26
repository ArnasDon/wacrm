import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  authenticated: true,
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: h.authenticated ? { id: 'user-1' } : null },
      }),
    },
    rpc: h.rpc,
  }),
}));

import { GET } from './route';

const flowId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const context = { params: Promise.resolve({ id: flowId }) };
const result = {
  flow: { id: flowId, name: 'Support' },
  version: { id: versionId, version: 2, label: null },
  available_versions: [{ id: versionId, version: 2, label: null }],
  window: {
    from: '2026-01-01T00:00:00+00:00',
    to: '2026-02-01T00:00:00+00:00',
  },
  coverage_started_at: '2026-01-15T00:00:00+00:00',
  coverage_cohort: 'runs_started_after_tracking_enabled',
  legacy_attempts_excluded: 0,
  biggest_dropoff: null,
  nodes: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.authenticated = true;
  h.rpc.mockResolvedValue({ data: result, error: null });
});

describe('flow analytics API', () => {
  it('returns 401 without invoking analytics when unauthenticated', async () => {
    h.authenticated = false;

    const response = await GET(
      new Request(`http://localhost/api/flows/${flowId}/analytics`),
      context
    );

    expect(response.status).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('passes a strict version/window to the account-scoped RPC', async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/flows/${flowId}/analytics?version_id=${versionId}&from=2026-01-01T00%3A00%3A00.000Z&to=2026-02-01T00%3A00%3A00.000Z`
      ),
      context
    );

    expect(response.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith('get_flow_node_analytics', {
      p_flow_id: flowId,
      p_version_id: versionId,
      p_from: '2026-01-01T00:00:00.000Z',
      p_to: '2026-02-01T00:00:00.000Z',
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(result);
  });

  it('uses the published version and 30-day database default when omitted', async () => {
    await GET(
      new Request(`http://localhost/api/flows/${flowId}/analytics`),
      context
    );

    expect(h.rpc).toHaveBeenCalledWith('get_flow_node_analytics', {
      p_flow_id: flowId,
      p_version_id: null,
      p_from: null,
      p_to: null,
    });
  });

  it('rejects unknown params and windows over 366 days before the RPC', async () => {
    const unknown = await GET(
      new Request(`http://localhost/api/flows/${flowId}/analytics?unknown=1`),
      context
    );
    const overlong = await GET(
      new Request(
        `http://localhost/api/flows/${flowId}/analytics?from=2025-01-01T00%3A00%3A00.000Z&to=2026-01-02T00%3A00%3A00.001Z`
      ),
      context
    );

    expect(unknown.status).toBe(400);
    expect(overlong.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('returns an indistinguishable 404 for cross-account or version mismatch', async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: 'analytics_not_found' },
    });

    const response = await GET(
      new Request(
        `http://localhost/api/flows/${flowId}/analytics?version_id=${versionId}`
      ),
      context
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('does not leak SQL errors or accept malformed RPC results', async () => {
    h.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'relation secret_table does not exist' },
    });
    const sqlFailure = await GET(
      new Request(`http://localhost/api/flows/${flowId}/analytics`),
      context
    );
    h.rpc.mockResolvedValueOnce({
      data: { ...result, nodes: [{ advance_rate: 'NaN' }] },
      error: null,
    });
    const malformed = await GET(
      new Request(`http://localhost/api/flows/${flowId}/analytics`),
      context
    );

    expect(sqlFailure.status).toBe(500);
    expect(await sqlFailure.json()).toEqual({
      error: 'Unable to load analytics',
    });
    expect(malformed.status).toBe(500);
    expect(await malformed.json()).toEqual({
      error: 'Unable to load analytics',
    });
  });
});
