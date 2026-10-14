import { describe, it, expect } from 'vitest';
import type { SqlConnection } from '@/lib/db/transaction';
import { buildConversationContext } from './context';

function fakeDb(rows: unknown[]): SqlConnection {
  return { query: async () => ({ rows }) };
}

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      { sender_type: 'customer', content_text: 'third' },
      { sender_type: 'agent', content_text: 'second' },
      { sender_type: 'customer', content_text: 'first' },
    ];
    const out = await buildConversationContext(
      fakeDb(rows),
      'acct-1',
      'conv-1'
    );
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ]);
  });

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply' }]),
      'acct-1',
      'conv-1'
    );
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }]);
  });

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'acct-1',
      'conv-1'
    );
    expect(out).toEqual([{ role: 'user', content: 'real' }]);
  });
});
