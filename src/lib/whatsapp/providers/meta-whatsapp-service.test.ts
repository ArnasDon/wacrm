import { describe, expect, it, vi } from 'vitest';

const sendTextMessage = vi.fn();
const sendTemplateMessage = vi.fn();

vi.mock('@/lib/whatsapp/meta-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTextMessage: (...args: unknown[]) => sendTextMessage(...args),
  sendTemplateMessage: (...args: unknown[]) => sendTemplateMessage(...args),
}));

const { MetaWhatsAppService } = await import('./meta-whatsapp-service');

describe('MetaWhatsAppService', () => {
  const service = new MetaWhatsAppService({
    phoneNumberId: 'pn-1',
    accessToken: 'tok',
  });

  it('is flagged non-demo', () => {
    expect(service.isDemo).toBe(false);
  });

  it('sends on the first variant when it succeeds, without trying the rest', async () => {
    sendTextMessage.mockReset().mockResolvedValueOnce({ messageId: 'wamid.1' });
    const result = await service.sendText({
      toVariants: ['15551234567', '5551234567'],
      text: 'hi',
    });
    expect(result).toEqual({
      messageId: 'wamid.1',
      workingPhone: '15551234567',
    });
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    expect(sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '15551234567',
        phoneNumberId: 'pn-1',
        accessToken: 'tok',
      })
    );
  });

  it('retries the next variant on a "recipient not allowed" error', async () => {
    sendTemplateMessage
      .mockReset()
      .mockRejectedValueOnce(
        new Error('Recipient phone number not in allowed list')
      )
      .mockResolvedValueOnce({ messageId: 'wamid.2' });

    const result = await service.sendTemplate({
      toVariants: ['15551234567', '5551234567'],
      templateName: 'order_update',
    });
    expect(result).toEqual({
      messageId: 'wamid.2',
      workingPhone: '5551234567',
    });
    expect(sendTemplateMessage).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-recipient error — it propagates immediately', async () => {
    sendTemplateMessage
      .mockReset()
      .mockRejectedValueOnce(new Error('Invalid template name'));
    await expect(
      service.sendTemplate({ toVariants: ['1', '2'], templateName: 'bad' })
    ).rejects.toThrow('Invalid template name');
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
  });

  it('throws once every variant is exhausted', async () => {
    sendTemplateMessage
      .mockReset()
      .mockRejectedValueOnce(
        new Error('Recipient phone number not in allowed list')
      )
      .mockRejectedValueOnce(
        new Error('Recipient phone number not in allowed list')
      );
    await expect(
      service.sendTemplate({ toVariants: ['1', '2'], templateName: 'x' })
    ).rejects.toThrow('Recipient phone number not in allowed list');
    expect(sendTemplateMessage).toHaveBeenCalledTimes(2);
  });
});
