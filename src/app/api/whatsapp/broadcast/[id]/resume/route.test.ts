import { beforeEach, describe, expect, it, vi } from 'vitest';

// A campaign stopped by a delivery setting ("Stop on Meta API error" /
// "Pause on quality hold") is final: neither Resume nor Retry failed may
// restart it, whatever the campaign kind.

const mocks = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  driveCampaign: vi.fn(),
  claim: vi.fn(),
}));

function scopedClient() {
  const b = {
    select: () => b,
    eq: () => b,
    maybeSingle: async () => ({ data: mocks.row, error: null }),
  };
  return { from: () => b };
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    supabase: scopedClient(),
    accountId: 'acct-1',
    userId: 'user-1',
  })),
  toErrorResponse: vi.fn(() => Response.json({ error: 'x' }, { status: 500 })),
}));
vi.mock('@/lib/campaigns/advanced-scheduler', () => ({
  driveCampaign: mocks.driveCampaign,
}));
vi.mock('@/lib/whatsapp/broadcast-resume', () => ({
  claimBroadcastDelivery: mocks.claim,
  markBroadcastSending: vi.fn(),
  planBroadcastResume: vi.fn(),
  releaseBroadcastDelivery: vi.fn(),
  RESUME_SCOPES: ['pending', 'failed', 'all'],
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => {
    throw new Error('admin client must not be used for a stopped campaign');
  },
}));

const { POST } = await import('./route');
const { __resetRateLimitForTests } = await import('@/lib/rate-limit');

const call = (scope: string) =>
  POST(
    new Request('http://localhost/api/whatsapp/broadcast/b1/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope }),
    }),
    { params: Promise.resolve({ id: 'b1' }) }
  );

beforeEach(() => {
  __resetRateLimitForTests();
  vi.clearAllMocks();
});

describe('POST /api/whatsapp/broadcast/:id/resume — stopped campaigns', () => {
  it.each([
    ['advanced', 'pending'],
    ['advanced', 'failed'],
    ['standard', 'pending'],
    ['standard', 'failed'],
  ])('refuses a stopped %s campaign (scope %s)', async (kind, scope) => {
    mocks.row = {
      kind,
      config: { stopped_reason: 'Meta API error on Main: [135000] Generic user error' },
    };
    const res = await call(scope);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('campaign_stopped');
    expect(body.error).toContain('cannot be restarted');
    expect(mocks.driveCampaign).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });
});
