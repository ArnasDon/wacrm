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

  it('real UAZAPI envelope nests the message under `message`, not `data` (confirmed via 1c-ii smoke test)', () => {
    // Captured from a live instance — the OpenAPI spec's `{ event,
    // instance, data }` shape and the `{ EventType, data }` guess were
    // both wrong for the `messages` event; the real top level is
    // `{ EventType, message, chat, owner, token, instanceName,
    // BaseUrl, chatSource }`. Trimmed to the fields the adapter reads.
    const realEnvelope = {
      EventType: 'messages',
      instanceName: 'wacrm-acct-1',
      token: 'redacted',
      owner: '5541988887777',
      chatSource: 'updated',
      chat: { id: 'rb91fdb22579261', phone: '5541999998888' },
      message: {
        messageid: 'EFE3207154DC7A396B',
        id: '5541988887777:EFE3207154DC7A396B',
        chatid: '5541999998888@s.whatsapp.net',
        sender: '153275135479862@lid',
        sender_pn: '5541999998888@s.whatsapp.net',
        senderName: '',
        fromMe: false,
        isGroup: false,
        messageType: 'Conversation', // capitalized in the wild
        messageTimestamp: 1788368394000,
        text: 'teste',
        content: 'teste', // string, not an object, for plain text
        quoted: '',
        reaction: '',
        buttonOrListid: '',
        wasSentByApi: false,
        status: '',
      },
    };
    const out = uazapiMessageToInbound(realEnvelope, ROW);
    expect(out.providerMessageId).toBe('EFE3207154DC7A396B');
    expect(out.from).toBe(normalizePhone('5541999998888'));
    expect(out.timestamp.getTime()).toBe(1788368394000);
    expect(out.content).toEqual({ kind: 'text', text: 'teste' });
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

  it('ExtendedTextMessage (real UAZAPI type for text with a link preview) is still text', () => {
    // Confirmed via the 1c-ii smoke: a plain text message containing a
    // URL comes back with messageType "ExtendedTextMessage", not
    // "text" — `m.text` still carries the actual message body.
    const { content } = uazapiMessageToInbound(
      {
        data: msg({
          messageType: 'ExtendedTextMessage',
          text: 'https://meet.google.com/cmk-sijf-qry',
        }),
      },
      ROW
    );
    expect(content).toEqual({
      kind: 'text',
      text: 'https://meet.google.com/cmk-sijf-qry',
    });
  });

  it('ImageMessage (real UAZAPI type, confirmed via 1c-ii smoke) → media/image with a uazapi ref carrying messageId', () => {
    const { content } = uazapiMessageToInbound(
      {
        data: msg({
          messageType: 'ImageMessage',
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

  it('AudioMessage (real UAZAPI type, confirmed via 1c-ii smoke) → media/audio — note mediaType is empty string here, messageType is the only reliable signal', () => {
    const { content } = uazapiMessageToInbound(
      {
        data: msg({
          messageType: 'AudioMessage',
          mediaType: '', // confirmed empty on real audio payloads
          text: '',
          content: { mimetype: 'audio/ogg; codecs=opus', PTT: true },
        }),
      },
      ROW
    );
    expect(content).toMatchObject({
      kind: 'media',
      mediaKind: 'audio',
      mimeType: 'audio/ogg; codecs=opus',
    });
  });

  it('VideoMessage / DocumentMessage / StickerMessage — inferred from the same whatsmeow naming convention as the two confirmed types above', () => {
    const video = uazapiMessageToInbound(
      { data: msg({ messageType: 'VideoMessage', content: {} }) },
      ROW
    );
    const doc = uazapiMessageToInbound(
      { data: msg({ messageType: 'DocumentMessage', content: {} }) },
      ROW
    );
    const sticker = uazapiMessageToInbound(
      { data: msg({ messageType: 'StickerMessage', content: {} }) },
      ROW
    );
    expect(video.content).toMatchObject({ kind: 'media', mediaKind: 'video' });
    expect(doc.content).toMatchObject({ kind: 'media', mediaKind: 'document' });
    expect(sticker.content).toMatchObject({ kind: 'media', mediaKind: 'image' });
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
  // Returns an array: the real `messages_update` envelope's
  // `MessageIDs` can batch more than one id in a single event
  // (confirmed via the 1c-ii smoke — see the batch test below), so one
  // `InboundStatus` per id.

  it('maps Delivered → delivered', () => {
    const [s] = uazapiStatusToInbound(
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
    const [s] = uazapiStatusToInbound(
      { data: { messageid: 'uaz-msg-1', status: 'Queued' } },
      ROW
    );
    expect(s.status).toBe('Queued');
  });

  it('real UAZAPI messages_update nests under `event`, with MessageIDs/Type/Timestamp-in-seconds (confirmed via 1c-ii smoke test)', () => {
    const [s] = uazapiStatusToInbound(
      {
        EventType: 'messages_update',
        event: {
          Chat: '5541999998888@s.whatsapp.net',
          IsFromMe: false,
          IsGroup: false,
          MessageIDs: ['EFE3207154DC7A396B'],
          Sender: '5541999998888@s.whatsapp.net',
          Timestamp: 1788368521, // seconds, unlike message's ms
          Type: 'Read',
          chatid: '5541999998888@s.whatsapp.net',
        },
      },
      ROW
    );
    expect(s).toMatchObject({
      connectionId: 'conn-1',
      accountId: 'acc-1',
      providerMessageId: 'EFE3207154DC7A396B',
      status: 'read',
    });
    expect(s.timestamp.getTime()).toBe(1788368521000);
  });

  it('MessageIDs batching more than one id (confirmed via 1c-ii smoke — a real event carried 2 ids at once) → one InboundStatus per id', () => {
    const out = uazapiStatusToInbound(
      {
        EventType: 'messages_update',
        event: {
          MessageIDs: ['3EB06450D75D5A6E1E6D46', '3EB0C15E2BF11449853525'],
          Timestamp: 1788372206,
          Type: 'Read',
        },
      },
      ROW
    );
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.providerMessageId)).toEqual([
      '3EB06450D75D5A6E1E6D46',
      '3EB0C15E2BF11449853525',
    ]);
    for (const s of out) {
      expect(s.status).toBe('read');
      expect(s.timestamp.getTime()).toBe(1788372206000);
    }
  });
});
