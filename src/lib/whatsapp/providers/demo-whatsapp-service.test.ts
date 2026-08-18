import { describe, expect, it } from 'vitest';
import { DemoWhatsAppService } from './demo-whatsapp-service';

// DemoWhatsAppService is pure transport simulation — no network, no DB
// — so every method should resolve instantly with a `demo-` id and the
// first offered phone variant, regardless of what real Meta would think
// of the payload (no template approval, no recipient validation).
describe('DemoWhatsAppService', () => {
  const service = new DemoWhatsAppService();

  it('is flagged demo', () => {
    expect(service.isDemo).toBe(true);
  });

  it('sendText resolves with a demo- id and the first variant', async () => {
    const result = await service.sendText({
      toVariants: ['15551234567', '5551234567'],
      text: 'hello',
    });
    expect(result.messageId).toMatch(/^demo-/);
    expect(result.workingPhone).toBe('15551234567');
  });

  it('sendTemplate resolves with a demo- id even for an unapproved-looking template', async () => {
    const result = await service.sendTemplate({
      toVariants: ['15551234567'],
      templateName: 'not_a_real_template',
    });
    expect(result.messageId).toMatch(/^demo-/);
  });

  it('sendMedia resolves with a demo- id', async () => {
    const result = await service.sendMedia({
      toVariants: ['15551234567'],
      kind: 'image',
      link: 'https://example.com/x.jpg',
    });
    expect(result.messageId).toMatch(/^demo-/);
  });

  it('sendInteractiveButtons resolves with a demo- id', async () => {
    const result = await service.sendInteractiveButtons({
      toVariants: ['15551234567'],
      bodyText: 'Pick one',
      buttons: [{ id: 'a', title: 'A' }],
    });
    expect(result.messageId).toMatch(/^demo-/);
  });

  it('sendInteractiveList resolves with a demo- id', async () => {
    const result = await service.sendInteractiveList({
      toVariants: ['15551234567'],
      bodyText: 'Pick one',
      buttonLabel: 'Choose',
      sections: [{ rows: [{ id: 'a', title: 'A' }] }],
    });
    expect(result.messageId).toMatch(/^demo-/);
  });

  it('sendReaction resolves with a demo- id and echoes `to`', async () => {
    const result = await service.sendReaction({
      to: '15551234567',
      targetMessageId: 'demo-abc',
      emoji: '👍',
    });
    expect(result.messageId).toMatch(/^demo-/);
    expect(result.workingPhone).toBe('15551234567');
  });

  it('generates a distinct id per call', async () => {
    const a = await service.sendText({ toVariants: ['1'], text: 'a' });
    const b = await service.sendText({ toVariants: ['1'], text: 'b' });
    expect(a.messageId).not.toBe(b.messageId);
  });
});
