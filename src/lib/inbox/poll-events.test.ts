import { expect, it } from 'vitest';
import { snapshotEvents } from './poll-events';
it('does not replay the initial backlog and reports inserts, updates and removals', () => {
  const old = [{ id: 'one', status: 'sent' }];
  expect(snapshotEvents(null, old)).toEqual([]);
  expect(snapshotEvents(old, [{ id: 'one', status: 'read' }, { id: 'two', status: 'sent' }])).toMatchObject([
    { eventType: 'UPDATE', new: { id: 'one', status: 'read' }, old: { status: 'sent' } },
    { eventType: 'INSERT', new: { id: 'two' } },
  ]);
  expect(snapshotEvents(old, [], true)).toMatchObject([{ eventType: 'DELETE', old: { id: 'one' } }]);
  expect(snapshotEvents(old, [], false)).toEqual([]);
});
