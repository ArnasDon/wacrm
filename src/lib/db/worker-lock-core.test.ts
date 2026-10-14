import { expect, it, vi } from 'vitest';
import { withWorkerLock } from './worker-lock-core';

it('unlocks and discards a failed lease after provider failure without a SQL transaction', async () => {
  const client = { query: vi.fn(async (_sql: string) => ({ rows: [] })), release: vi.fn() };
  await expect(
    withWorkerLock(
      { connect: async () => client },
      'flow:account:contact',
      async () => {
        throw new Error('provider failed');
      }
    )
  ).rejects.toThrow('provider failed');
  expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
    'SELECT pg_advisory_lock(hashtextextended($1,0))',
    'SELECT pg_advisory_unlock(hashtextextended($1,0))',
  ]);
  expect(client.release).toHaveBeenCalledWith(true);
});
