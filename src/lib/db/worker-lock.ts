import 'server-only';
import { getPool } from './pool';
import { withWorkerLock } from './worker-lock-core';

export function withFlowContactLock<T>(
  accountId: string,
  contactId: string,
  work: () => Promise<T>
) {
  // Separate pool: waiting on a contact cannot starve the SQL used by its sender.
  return withWorkerLock(
    getPool('coordination'),
    `flow:${accountId}:${contactId}`,
    work
  );
}
