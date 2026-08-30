import { describe, it, expect } from 'vitest';
import {
  metaMessageToInbound,
  metaStatusToInbound,
  type WhatsAppMessage,
} from './meta-adapter';

const ROW = { id: 'conn-1', account_id: 'acc-1', user_id: 'user-1' };
const CONTACT = { profile: { name: 'Ada' }, wa_id: '15551230000' };

function base(overrides: Partial<WhatsAppMessage>): WhatsAppMessage {
  return {
    id: 'wamid.1',
    from: '15551230000',
    timestamp: '1700000000',
    type: 'text',
    ...overrides,
  } as WhatsAppMessage;
}

describe('metaMessageToInbound — common envelope fields', () => {
  it('stamps connection / account / owner / ids / timestamp from the row and message', () => {
    const msg = metaMessageToInbound(
      base({
        type: 'text',
        text: { body: 'hello' },
        context: { id: 'wamid.parent' },
      }),
      CONTACT,
      ROW
    );
    expect(msg).toMatchObject({
      connectionId: 'conn-1',
      accountId: 'acc-1',
      configOwnerUserId: 'user-1',
      providerMessageId: 'wamid.1',
      from: '15551230000',
      senderName: 'Ada',
      replyToProviderMessageId: 'wamid.parent',
    });
    expect(msg.timestamp).toBeInstanceOf(Date);
    expect(msg.timestamp.getTime()).toBe(1700000000 * 1000);
  });

  it('leaves replyToProviderMessageId undefined when there is no context', () => {
    const msg = metaMessageToInbound(
      base({ text: { body: 'hi' } }),
      CONTACT,
      ROW
    );
    expect(msg.replyToProviderMessageId).toBeUndefined();
  });
});

describe('metaMessageToInbound — content per message.type', () => {
  it('text', () => {
    const { content } = metaMessageToInbound(
      base({ type: 'text', text: { body: 'hello world' } }),
      CONTACT,
      ROW
    );
    expect(content).toEqual({ kind: 'text', text: 'hello world' });
  });

  it('image (with id) → media/image + meta ref', () => {
    const { content } = metaMessageToInbound(
      base({
        type: 'image',
        image: { id: 'mid-img', mime_type: 'image/jpeg', caption: 'a cat' },
      }),
      CONTACT,
      ROW
    );
    expect(content).toEqual({
      kind: 'media',
      mediaKind: 'image',
      caption: 'a cat',
      mimeType: 'image/jpeg',
      ref: { provider: 'meta', mediaId: 'mid-img' },
    });
  });

  it('video (with id) → media/video, empty caption dropped', () => {
    const { content } = metaMessageToInbound(
      base({ type: 'video', video: { id: 'mid-vid', mime_type: 'video/mp4' } }),
      CONTACT,
      ROW
    );
    expect(content).toEqual({
      kind: 'media',
      mediaKind: 'video',
      caption: undefined,
      mimeType: 'video/mp4',
      ref: { provider: 'meta', mediaId: 'mid-vid' },
    });
  });

  it('document (with id) → media/document; filename backfills caption', () => {
    const { content } = metaMessageToInbound(
      base({
        type: 'document',
        document: {
          id: 'mid-doc',
          mime_type: 'application/pdf',
          filename: 'invoice.pdf',
        },
      }),
      CONTACT,
      ROW
    );
    expect(content).toEqual({
      kind: 'media',
      mediaKind: 'document',
      caption: 'invoice.pdf',
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      ref: { provider: 'meta', mediaId: 'mid-doc' },
    });
  });

  it('audio (with id) → media/audio, no caption/filename', () => {
    const { content } = metaMessageToInbound(
      base({
        type: 'audio',
        audio: { id: 'mid-aud', mime_type: 'audio/ogg; codecs=opus' },
      }),
      CONTACT,
      ROW
    );
    expect(content).toEqual({
      kind: 'media',
      mediaKind: 'audio',
      mimeType: 'audio/ogg; codecs=opus',
      ref: { provider: 'meta', mediaId: 'mid-aud' },
    });
  });

  it('sticker (with id) → media/image', () => {
    const { content } = metaMessageToInbound(
      base({
        type: 'sticker',
        sticker: { id: 'mid-stk', mime_type: 'image/webp' },
      }),
      CONTACT,
      ROW
    );
    expect(content).toEqual({
      kind: 'media',
      mediaKind: 'image',
      mimeType: 'image/webp',
      ref: { provider: 'meta', mediaId: 'mid-stk' },
    });
  });

  it('location → location with name/address', () => {
    const { content } = metaMessageToInbound(
      base({
        type: 'location',
        location: {
          latitude: -23.5,
          longitude: -46.6,
          name: 'Office',
          address: 'Av. Paulista',
        },
      }),
      CONTACT,
      ROW
    );
    expect(content).toEqual({
      kind: 'location',
      latitude: -23.5,
      longitude: -46.6,
      name: 'Office',
      address: 'Av. Paulista',
    });
  });

  it('reaction → reaction with target + emoji', () => {
    const { content } = metaMessageToInbound(
      base({
        type: 'reaction',
        reaction: { message_id: 'wamid.target', emoji: '👍' },
      }),
      CONTACT,
      ROW
    );
    expect(content).toEqual({
      kind: 'reaction',
      targetProviderMessageId: 'wamid.target',
      emoji: '👍',
    });
  });

  it('interactive (button_reply with id) → interactive_reply', () => {
    const { content } = metaMessageToInbound(
      base({
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'OPT_A', title: 'Existing customer' },
        },
      }),
      CONTACT,
      ROW
    );
    expect(content).toEqual({
      kind: 'interactive_reply',
      replyId: 'OPT_A',
      title: 'Existing customer',
    });
  });

  it('interactive (list_reply, blank title) → title falls back to id', () => {
    const { content } = metaMessageToInbound(
      base({
        type: 'interactive',
        interactive: {
          type: 'list_reply',
          list_reply: { id: 'ROW_1', title: '' },
        },
      }),
      CONTACT,
      ROW
    );
    expect(content).toEqual({
      kind: 'interactive_reply',
      replyId: 'ROW_1',
      title: 'ROW_1',
    });
  });

  it('button (template quick-reply) → interactive_reply, payload is the reply id', () => {
    const { content } = metaMessageToInbound(
      base({
        type: 'button',
        button: { text: 'Yes, interested', payload: 'YES_INTERESTED' },
      }),
      CONTACT,
      ROW
    );
    expect(content).toEqual({
      kind: 'interactive_reply',
      replyId: 'YES_INTERESTED',
      title: 'Yes, interested',
    });
  });

  it('button with no payload → label is used for both id and title', () => {
    const { content } = metaMessageToInbound(
      base({ type: 'button', button: { text: 'Track my order' } }),
      CONTACT,
      ROW
    );
    expect(content).toEqual({
      kind: 'interactive_reply',
      replyId: 'Track my order',
      title: 'Track my order',
    });
  });

  it('unknown type → unsupported carrying the raw type', () => {
    const { content } = metaMessageToInbound(
      base({ type: 'contacts' }),
      CONTACT,
      ROW
    );
    expect(content).toEqual({ kind: 'unsupported', rawType: 'contacts' });
  });
});

describe('metaStatusToInbound', () => {
  it('normalizes a status event into InboundStatus', () => {
    const s = metaStatusToInbound(
      {
        id: 'wamid.99',
        status: 'delivered',
        timestamp: '1700000123',
        recipient_id: '15551230000',
      },
      ROW
    );
    expect(s).toEqual({
      connectionId: 'conn-1',
      accountId: 'acc-1',
      providerMessageId: 'wamid.99',
      status: 'delivered',
      timestamp: new Date(1700000123 * 1000),
    });
  });
});
