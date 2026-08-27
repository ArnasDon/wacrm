import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  anthropic: vi.fn(),
  openai: vi.fn(),
  telegram: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/ai/providers/anthropic', () => ({ generateAnthropic: H.anthropic }));
vi.mock('@/lib/ai/providers/openai', () => ({ generateOpenAi: H.openai }));
vi.mock('./alerts', () => ({ sendTelegramMessage: H.telegram }));
vi.mock('@/lib/platform/admin-client', () => ({
  platformAdminClient: () => ({ from: H.from }),
}));

import { runAlertTriage, isTriageConfigured } from './triage';

const ALERT = {
  severity: 'critical' as const,
  source: 'cron_heartbeat',
  title: 'Cron "flows_cron" has not run',
  detail: { job: 'flows_cron', ageSeconds: 4000 },
  dedupKey: 'cron_heartbeat:flows_cron',
  alertId: 'al-1',
};

beforeEach(() => {
  H.anthropic.mockReset();
  H.openai.mockReset();
  H.telegram.mockReset();
  H.from.mockReset();
  H.telegram.mockResolvedValue(true);
  H.from.mockReturnValue({
    select: () => {
      const chain: Record<string, unknown> = {
        is: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: [], error: null }),
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(res),
      };
      return chain;
    },
  });
  delete process.env.OPS_AI_API_KEY;
  delete process.env.OPS_AI_PROVIDER;
  delete process.env.OPS_AI_MODEL;
});

describe('isTriageConfigured', () => {
  it('is false without OPS_AI_API_KEY', () => {
    expect(isTriageConfigured()).toBe(false);
  });
  it('is true with OPS_AI_API_KEY', () => {
    process.env.OPS_AI_API_KEY = 'sk-ops';
    expect(isTriageConfigured()).toBe(true);
  });
});

describe('runAlertTriage', () => {
  it('is a no-op returning null when unconfigured', async () => {
    const out = await runAlertTriage(ALERT);
    expect(out).toBeNull();
    expect(H.anthropic).not.toHaveBeenCalled();
    expect(H.openai).not.toHaveBeenCalled();
    expect(H.telegram).not.toHaveBeenCalled();
  });

  it('defaults to the anthropic adapter and posts the diagnosis to Telegram', async () => {
    process.env.OPS_AI_API_KEY = 'sk-ops';
    H.anthropic.mockResolvedValue({ text: 'CAUSE: scheduler stopped.\nCHECK: cron.job\nFIX: reschedule', usage: null });

    const out = await runAlertTriage(ALERT);

    expect(out).toContain('CAUSE:');
    expect(H.anthropic).toHaveBeenCalledOnce();
    expect(H.openai).not.toHaveBeenCalled();
    expect(H.telegram).toHaveBeenCalledOnce();
    const posted = H.telegram.mock.calls[0][0] as string;
    expect(posted).toContain('TRIAGE');
    expect(posted).toContain(ALERT.title);
  });

  it('uses the openai adapter when OPS_AI_PROVIDER=openai', async () => {
    process.env.OPS_AI_API_KEY = 'sk-ops';
    process.env.OPS_AI_PROVIDER = 'openai';
    H.openai.mockResolvedValue({ text: 'CAUSE: x', usage: null });

    await runAlertTriage(ALERT);

    expect(H.openai).toHaveBeenCalledOnce();
    expect(H.anthropic).not.toHaveBeenCalled();
  });

  it('returns null and never throws when the model call fails', async () => {
    process.env.OPS_AI_API_KEY = 'sk-ops';
    H.anthropic.mockRejectedValue(new Error('provider 500'));

    await expect(runAlertTriage(ALERT)).resolves.toBeNull();
    expect(H.telegram).not.toHaveBeenCalled();
  });

  it('returns null when the model returns empty text', async () => {
    process.env.OPS_AI_API_KEY = 'sk-ops';
    H.anthropic.mockResolvedValue({ text: '   ', usage: null });

    await expect(runAlertTriage(ALERT)).resolves.toBeNull();
  });
});
