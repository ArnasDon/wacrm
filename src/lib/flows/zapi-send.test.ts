import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  sendText: vi.fn(),
  sendImage: vi.fn(),
  sendVideo: vi.fn(),
  sendDocument: vi.fn(),
  supabaseAdmin: vi.fn(),
}));

vi.mock('@/lib/whatsapp/zapi-api', () => ({
  sendText: h.sendText,
  sendImage: h.sendImage,
  sendVideo: h.sendVideo,
  sendDocument: h.sendDocument,
}));

vi.mock('@/lib/whatsapp/zapi-config', () => ({
  buildZapiCredentials: () => ({
    instanceId: 'instance',
    token: 'token',
    clientToken: 'client',
  }),
}));

vi.mock('./admin-client', () => ({
  supabaseAdmin: h.supabaseAdmin,
}));

import {
  engineSendInteractiveButtons,
  engineSendMedia,
  engineSendText,
} from './zapi-send';

function fakeDb(
  failAt?: 'message_insert' | 'conversation_update',
  events: string[] = []
) {
  return {
    from(table: string) {
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'contact-1', phone: '+5511999999999' },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'whatsapp_config') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { enabled: true }, error: null }),
            }),
          }),
        };
      }
      if (table === 'messages') {
        return {
          insert: async () => {
            events.push('message_insert')
            return {
              error:
                failAt === 'message_insert'
                  ? { message: 'messages unavailable' }
                  : null,
            }
          },
        };
      }
      if (table === 'conversations') {
        return {
          update: () => ({
            eq: async () => ({
              error:
                failAt === 'conversation_update'
                  ? { message: 'conversations unavailable' }
                  : null,
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

const commonArgs = {
  accountId: 'account-1',
  userId: 'user-1',
  conversationId: 'conversation-1',
  contactId: 'contact-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.sendText.mockResolvedValue({ messageId: 'wamid-committed' });
  h.sendImage.mockResolvedValue({ messageId: 'wamid-committed' });
});

describe('committed Z-API side effects', () => {
  it('reports the remote boundary before local persistence', async () => {
    const events: string[] = []
    h.supabaseAdmin.mockReturnValue(fakeDb(undefined, events))

    await engineSendText({
      ...commonArgs,
      text: 'Hello',
      onRemoteCommitted: async (result) => {
        expect(result.whatsapp_message_id).toBe('wamid-committed')
        events.push('remote_committed')
      },
    })

    expect(events).toEqual(['remote_committed', 'message_insert'])
  })

  it.each([
    {
      label: 'text',
      send: () => engineSendText({ ...commonArgs, text: 'Hello' }),
      externalSend: h.sendText,
    },
    {
      label: 'media',
      send: () =>
        engineSendMedia({
          ...commonArgs,
          kind: 'image',
          link: 'https://example.com/image.png',
        }),
      externalSend: h.sendImage,
    },
    {
      label: 'interactive',
      send: () =>
        engineSendInteractiveButtons({
          ...commonArgs,
          bodyText: 'Choose',
          buttons: [{ id: 'yes', title: 'Yes' }],
        }),
      externalSend: h.sendText,
    },
  ])(
    'marks a $label message insert failure as externally committed',
    async ({ send, externalSend }) => {
      h.supabaseAdmin.mockReturnValue(fakeDb('message_insert'));

      const error = await send().catch((caught) => caught);

      expect(externalSend).toHaveBeenCalledTimes(1);
      expect(error).toMatchObject({
        name: 'CommittedSideEffectError',
        retryable: false,
        sideEffectCommitted: true,
        externalReference: 'wamid-committed',
        persistenceStage: 'message_insert',
      });
    }
  );

  it('marks a conversation update failure as externally committed', async () => {
    h.supabaseAdmin.mockReturnValue(fakeDb('conversation_update'));

    const error = await engineSendText({
      ...commonArgs,
      text: 'Hello',
    }).catch((caught) => caught);

    expect(h.sendText).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({
      name: 'CommittedSideEffectError',
      sideEffectCommitted: true,
      externalReference: 'wamid-committed',
      persistenceStage: 'conversation_update',
    });
  });
});
