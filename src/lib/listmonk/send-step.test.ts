import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('./client', () => ({
  sendTransactional: vi.fn(async (input: unknown) => {
    h.calls.push(input);
    return true;
  }),
}));

import {
  NoEmailAddressError,
  buildTxData,
  firstName,
  sendEmailToContact,
  type EmailableContact,
} from './send-step';

const contact: EmailableContact = {
  id: 'c-1',
  name: 'Jane Q Doe',
  email: 'Jane@Example.com',
  phone: '+14155550123',
  company: 'Acme',
};

beforeEach(() => {
  h.calls.length = 0;
});

describe('firstName', () => {
  it('takes the first whitespace-separated token', () => {
    expect(firstName('Jane Q Doe')).toBe('Jane');
  });
  it('is empty for missing names rather than "undefined"', () => {
    expect(firstName(null)).toBe('');
    expect(firstName('   ')).toBe('');
  });
});

describe('buildTxData', () => {
  it('exposes the contact under a stable, documented shape', () => {
    const data = buildTxData({ contact, templateId: 1 });
    expect(data.contact).toEqual({
      id: 'c-1',
      name: 'Jane Q Doe',
      first_name: 'Jane',
      email: 'jane@example.com',
      phone: '+14155550123',
      company: 'Acme',
    });
    expect(data.source).toBe('wacrm');
  });

  it('always provides vars, even when the step had none', () => {
    expect(buildTxData({ contact, templateId: 1 }).vars).toEqual({});
  });

  it('passes flow vars and the inbound message through', () => {
    const data = buildTxData({
      contact,
      templateId: 1,
      vars: { order: 'A-1' },
      messageText: 'where is my order',
    });
    expect(data.vars).toEqual({ order: 'A-1' });
    expect(data.message).toEqual({ text: 'where is my order' });
  });

  it('omits the message key entirely when there was no inbound text', () => {
    expect(buildTxData({ contact, templateId: 1 })).not.toHaveProperty(
      'message'
    );
  });
});

describe('sendEmailToContact', () => {
  it('sends in external mode so the contact need not be a subscriber', async () => {
    const result = await sendEmailToContact({ contact, templateId: 7 });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({
      template_id: 7,
      email: 'jane@example.com',
    });
    expect(result).toContain('jane@example.com');
  });

  it('forwards a non-empty subject override and drops a blank one', async () => {
    await sendEmailToContact({ contact, templateId: 7, subject: '  Hello  ' });
    expect(h.calls[0]).toMatchObject({ subject: 'Hello' });
    await sendEmailToContact({ contact, templateId: 7, subject: '   ' });
    expect(h.calls[1]).not.toHaveProperty('subject');
  });

  // The distinction matters: engines treat this as a SKIP, not a
  // failure. A WhatsApp-only contact is a normal case.
  it('throws NoEmailAddressError for contacts without a usable email', async () => {
    await expect(
      sendEmailToContact({
        contact: { ...contact, email: null },
        templateId: 7,
      })
    ).rejects.toBeInstanceOf(NoEmailAddressError);
    await expect(
      sendEmailToContact({
        contact: { ...contact, email: "x'--@evil" },
        templateId: 7,
      })
    ).rejects.toBeInstanceOf(NoEmailAddressError);
    expect(h.calls).toHaveLength(0);
  });

  it('refuses to send without a template', async () => {
    await expect(
      sendEmailToContact({ contact, templateId: 0 })
    ).rejects.toThrow(/template/);
    expect(h.calls).toHaveLength(0);
  });
});
