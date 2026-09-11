import { describe, expect, it } from 'vitest';
import { resolveWhatsAppRecipient } from './recipient';

describe('resolveWhatsAppRecipient', () => {
  it('keeps legacy phone contacts working', () => {
    expect(resolveWhatsAppRecipient({ phone: '+1 (809) 555-1234' })).toEqual({
      type: 'phone', value: '18095551234',
    });
  });

  it('prefers a BSUID over a phone and never uses a username as identity', () => {
    expect(resolveWhatsAppRecipient({
      phone: '+18095551234',
      whatsapp_user_id: 'DO.ABC123',
    })).toEqual({ type: 'bsuid', value: 'DO.ABC123' });
  });

  it('rejects contacts with neither a valid phone nor BSUID', () => {
    expect(resolveWhatsAppRecipient({ phone: null })).toBeNull();
  });
});
