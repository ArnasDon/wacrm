import { describe, it, expect, vi } from 'vitest';
import { logAiUsage } from './usage';
const args = {
  accountId: 'account',
  conversationId: 'conversation',
  mode: 'draft' as const,
  provider: 'openai' as const,
  model: 'model',
  usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
};
describe('logAiUsage', () => {
  it('maps normalized usage to parameterized columns', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await logAiUsage({ query }, args);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.ai_usage_log'),
      ['account', 'conversation', 'draft', 'openai', 'model', 30, 6, 36]
    );
  });
  it('skips absent usage', async () => {
    const query = vi.fn();
    await logAiUsage({ query }, { ...args, usage: null });
    expect(query).not.toHaveBeenCalled();
  });
  it('swallows failed inserts', async () => {
    const query = vi.fn().mockRejectedValue(new Error('unavailable'));
    await expect(logAiUsage({ query }, args)).resolves.toBeUndefined();
  });
});
