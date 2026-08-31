import { describe, it, expect } from 'vitest';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  eventTypeOf,
  eventKindOf,
  uazapiMessageToInbound,
  uazapiStatusToInbound,
  type UazapiConnectionRowLite,
} from './uazapi-adapter';

const ROW: UazapiConnectionRowLite = {
  id: 'conn-1',
  account_id: 'acc-1',
  user_id: 'user-1',
  uazapi_instance_id: 'inst-1',
};

/** A minimal received `Message` as UAZAPI nests it under `data`. */
function msg(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    messageid: 'uaz-msg-1',
    chatid: '5541999998888@s.whatsapp.net',
    messageType: 'text',
    messageTimestamp: 1735689600000,
    text: 'hello',
    ...overrides,
  };
}

describe('eventTypeOf', () => {
  it('reads payload.EventType', () => {
    expect(eventTypeOf({ EventType: 'messages', data: {} })).toBe('messages');
  });

  it('falls back to payload.event', () => {
    expect(eventTypeOf({ event: 'message', instance: 'i', data: {} })).toBe(
      'message'
    );
  });

  it('is the empty string when neither is present', () => {
    expect(eventTypeOf({ data: {} })).toBe('');
  });
});

describe('eventKindOf — singular/plural vocab tolerance', () => {
  it('maps message vocab', () => {
    expect(eventKindOf({ event: 'message' })).toBe('message');
    expect(eventKindOf({ EventType: 'messages' })).toBe('message');
  });

  it('maps status vocab', () => {
    expect(eventKindOf({ event: 'status' })).toBe('status');
    expect(eventKindOf({ EventType: 'messages_update' })).toBe('status');
  });

  it('maps connection vocab', () => {
    expect(eventKindOf({ event: 'connection' })).toBe('connection');
  });

  it('everything else is "other"', () => {
    expect(eventKindOf({ event: 'presence' })).toBe('other');
  });
});

describe('uazapiMessageToInbound — envelope shape tolerance', () => {
  it('nested ({ EventType, data: {msg} }) and flattened envelopes produce the same InboundMessage', () => {
    const m = msg({ text: 'same' });
    const nested = uazapiMessageToInbound(
      { EventType: 'messages', data: m },
      ROW
    );
    const flat = uazapiMessageToInbound({ EventType: 'messages', ...m }, ROW);
    expect(nested).toEqual(flat);
    expect(nested).toMatchObject({
      connectionId: 'conn-1',
      accountId: 'acc-1',
      configOwnerUserId: 'user-1',
      providerMessageId: 'uaz-msg-1',
      content: { kind: 'text', text: 'same' },
    });
  });
});

describe('uazapiMessageToInbound — common fields', () => {
  it('messageTimestamp is milliseconds — NOT multiplied by 1000', () => {
    const out = uazapiMessageToInbound(
      { data: msg({ messageTimestamp: 1735689600000 }) },
      ROW
    );
    expect(out.timestamp).toBeInstanceOf(Date);
    expect(out.timestamp.getTime()).toBe(1735689600000);
  });

  it('from = digits before @ in chatid, run through normalizePhone', () => {
    const out = uazapiMessageToInbound(
      { data: msg({ chatid: '5541999998888@s.whatsapp.net' }) },
      ROW
    );
    expect(out.from).toBe(normalizePhone('5541999998888'));
  });
});

describe('uazapiMessageToInbound — content discrimination', () => {
  it('text', () => {
    const { content } = uazapiMessageToInbound(
      { data: msg({ messageType: 'text', text: 'hello world' }) },
      ROW
    );
    expect(content).toEqual({ kind: 'text', text: 'hello world' });
  });

  it('image → media/image with a uazapi ref carrying messageId', () => {
    const { content } = uazapiMessageToInbound(
      {
        data: msg({
          messageType: 'image',
          text: 'a cat',
          content: { mimetype: 'image/jpeg' },
        }),
      },
      ROW
    );
    expect(content).toEqual({
      kind: 'media',
      mediaKind: 'image',
      caption: 'a cat',
      filename: undefined,
      mimeType: 'image/jpeg',
      ref: { provider: 'uazapi', messageId: 'uaz-msg-1' },
    });
  });

  it('reaction → target is the reaction id, emoji comes from text', () => {
    const { content } = uazapiMessageToInbound(
      {
        data: msg({
          messageType: 'reaction',
          reaction: 'uaz-target-9',
          text: '👍',
        }),
      },
      ROW
    );
    expect(content).toEqual({
      kind: 'reaction',
      targetProviderMessageId: 'uaz-target-9',
      emoji: '👍',
    });
  });

  it('buttonOrListid → interactive_reply', () => {
    const { content } = uazapiMessageToInbound(
      {
        data: msg({
          messageType: 'text',
          buttonOrListid: 'opt_1',
          text: 'Sim',
        }),
      },
      ROW
    );
    expect(content).toEqual({
      kind: 'interactive_reply',
      replyId: 'opt_1',
      title: 'Sim',
    });
  });

  it('unknown messageType → unsupported carrying the raw type', () => {
    const { content } = uazapiMessageToInbound(
      { data: msg({ messageType: 'poll', text: '' }) },
      ROW
    );
    expect(content).toEqual({ kind: 'unsupported', rawType: 'poll' });
  });
});

describe('uazapiStatusToInbound', () => {
  it('maps Delivered → delivered', () => {
    const s = uazapiStatusToInbound(
      {
        data: {
          messageid: 'uaz-msg-1',
          status: 'Delivered',
          messageTimestamp: 1735689600000,
        },
      },
      ROW
    );
    expect(s).toMatchObject({
      connectionId: 'conn-1',
      accountId: 'acc-1',
      providerMessageId: 'uaz-msg-1',
      status: 'delivered',
    });
    expect(s.timestamp.getTime()).toBe(1735689600000);
  });

  it('passes unmapped status values through raw (Queued → Queued)', () => {
    const s = uazapiStatusToInbound(
      { data: { messageid: 'uaz-msg-1', status: 'Queued' } },
      ROW
    );
    expect(s.status).toBe('Queued');
  });
});
