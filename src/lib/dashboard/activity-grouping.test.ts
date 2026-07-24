import { describe, expect, it } from 'vitest';

import {
  groupIncomingMessages,
  type IncomingMessageActivity,
} from './activity-grouping';

function incoming(
  id: string,
  conversationId: string,
  at: string,
  contactLabel = 'Ada'
): IncomingMessageActivity {
  return { id, conversationId, at, contactLabel };
}

describe('groupIncomingMessages', () => {
  it('groups messages from one conversation inside a 15-minute block', () => {
    const items = groupIncomingMessages([
      incoming('older', 'conversation-1', '2026-07-24T12:00:00.000Z'),
      incoming('latest', 'conversation-1', '2026-07-24T12:15:00.000Z'),
    ]);

    expect(items).toEqual([
      {
        id: 'msg-latest',
        kind: 'message',
        text: '2 new messages from Ada',
        at: '2026-07-24T12:15:00.000Z',
        href: '/inbox?c=conversation-1',
      },
    ]);
  });

  it('starts another block when the oldest event is over 15 minutes from the latest', () => {
    const items = groupIncomingMessages([
      incoming('middle', 'conversation-1', '2026-07-24T12:10:00.000Z'),
      incoming('oldest', 'conversation-1', '2026-07-24T12:04:00.000Z'),
      incoming('latest', 'conversation-1', '2026-07-24T12:20:00.000Z'),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'msg-latest',
      text: '2 new messages from Ada',
      at: '2026-07-24T12:20:00.000Z',
    });
    expect(items[1]).toMatchObject({
      id: 'msg-oldest',
      text: 'New message from Ada',
      at: '2026-07-24T12:04:00.000Z',
    });
  });

  it('never groups different conversations and keeps each latest deep-link', () => {
    const items = groupIncomingMessages([
      incoming('ada', 'conversation/ada', '2026-07-24T12:20:00.000Z'),
      incoming(
        'grace',
        'conversation-grace',
        '2026-07-24T12:19:00.000Z',
        'Grace'
      ),
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        id: 'msg-ada',
        href: '/inbox?c=conversation%2Fada',
      }),
      expect.objectContaining({
        id: 'msg-grace',
        text: 'New message from Grace',
        href: '/inbox?c=conversation-grace',
      }),
    ]);
  });
});
