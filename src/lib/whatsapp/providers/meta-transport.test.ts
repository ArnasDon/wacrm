import { describe, expect, it, vi, beforeEach } from 'vitest';

const sendTextMessage = vi.fn();
const sendReactionMessage = vi.fn();

vi.mock('@/lib/whatsapp/meta-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTextMessage: (...a: unknown[]) => sendTextMessage(...a),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid.media' })),
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid.tpl' })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid.btn' })),
  sendInteractiveList: vi.fn(async () => ({ messageId: 'wamid.list' })),
  sendReactionMessage: (...a: unknown[]) => sendReactionMessage(...a),
}));

import { createMetaTransport } from './meta-transport';
import { createTransport } from './index';
import type { TransportConnection } from './types';

const conn: TransportConnection = {
  id: 'cfg-1',
  accountId: 'acct-1',
  provider: 'meta',
  phoneNumberId: 'pn-1',
  credential: 'plain-token',
};

const NOT_ALLOWED = '(#131030) Recipient phone number not in allowed list';

beforeEach(() => {
  sendTextMessage.mockReset();
  sendReactionMessage.mockReset();
});

describe('createMetaTransport', () => {
  it('declara as capacidades da Meta', () => {
    expect(createMetaTransport(conn).capabilities).toEqual({
      templates: true,
      interactive: true,
      reactions: true,
      media: true,
    });
    expect(createMetaTransport(conn).provider).toBe('meta');
  });

  it('envia texto pelo phone_number_id da conexão e não reporta normalização quando a primeira variante passa', async () => {
    sendTextMessage.mockResolvedValueOnce({ messageId: 'wamid.1' });
    const result = await createMetaTransport(conn).sendText({
      to: '5511999998888',
      text: 'oi',
    });
    expect(result).toEqual({
      providerMessageId: 'wamid.1',
      normalizedRecipient: undefined,
    });
    expect(sendTextMessage).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'plain-token',
      to: '5511999998888',
      text: 'oi',
      contextMessageId: undefined,
    });
  });

  it('tenta a próxima variante em "recipient not allowed" e reporta o número aceito', async () => {
    sendTextMessage
      .mockRejectedValueOnce(new Error(NOT_ALLOWED))
      .mockResolvedValueOnce({ messageId: 'wamid.2' });

    const result = await createMetaTransport(conn).sendText({
      to: '5511999998888',
      text: 'oi',
    });

    expect(result.providerMessageId).toBe('wamid.2');
    // `phoneVariants('5511999998888')` devolve, nesta ordem:
    // ['5511999998888', '50511999998888', '55011999998888',
    //  '55101999998888']. A segunda tentativa usa o índice 1.
    expect(result.normalizedRecipient).toBe('50511999998888');
    expect(sendTextMessage).toHaveBeenCalledTimes(2);
  });

  it('não tenta outra variante em erro que não seja "recipient not allowed"', async () => {
    sendTextMessage.mockRejectedValue(new Error('(#132000) Template mismatch'));
    await expect(
      createMetaTransport(conn).sendText({ to: '5511999998888', text: 'oi' })
    ).rejects.toThrow(/132000/);
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('propaga o último erro quando todas as variantes são rejeitadas', async () => {
    sendTextMessage.mockRejectedValue(new Error(NOT_ALLOWED));
    await expect(
      createMetaTransport(conn).sendText({ to: '5511999998888', text: 'oi' })
    ).rejects.toThrow(/131030/);
    expect(sendTextMessage.mock.calls.length).toBeGreaterThan(1);
  });

  it('manda reação sem retry de variante (paridade com /api/whatsapp/react)', async () => {
    sendReactionMessage.mockRejectedValueOnce(new Error(NOT_ALLOWED));
    await expect(
      createMetaTransport(conn).sendReaction({
        to: '5511999998888',
        targetProviderMessageId: 'wamid.target',
        emoji: '👍',
      })
    ).rejects.toThrow(/131030/);
    expect(sendReactionMessage).toHaveBeenCalledTimes(1);
  });
});

describe('createTransport', () => {
  it('devolve o transporte Meta para provider="meta"', () => {
    expect(createTransport(conn).provider).toBe('meta');
  });

  it('lança para um provider ainda não implementado', () => {
    expect(() => createTransport({ ...conn, provider: 'uazapi' })).toThrow(
      /uazapi/
    );
  });
});
