import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ role: 'viewer', release: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireSession: vi.fn() }));
vi.mock('./pool', () => ({
  getPool: () => ({
    connect: async () => ({
      release: state.release,
      query: async (sql: string) => ({
        rows: sql.includes('FROM public.profiles')
          ? [
              {
                account_id: 'account',
                account_role: state.role,
                name: 'Account',
                default_currency: 'USD',
              },
            ]
          : [],
      }),
    }),
  }),
}));
import { withAccount } from './context';
it('rejects a stale privileged role before exposing provider credentials or side effects', async () => {
  const action = vi.fn();
  await expect(
    withAccount(
      {
        userId: '10000000-0000-4000-8000-000000000001',
        accountId: 'account',
        role: 'agent',
        account: { id: 'account', name: 'Account', default_currency: 'USD' },
      },
      action
    )
  ).rejects.toThrow(/membership changed/i);
  expect(action).not.toHaveBeenCalled();
});
