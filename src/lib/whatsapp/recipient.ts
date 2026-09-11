import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';

export type WhatsAppRecipient =
  | { type: 'phone'; value: string }
  | { type: 'bsuid'; value: string };

export interface WhatsAppContactIdentity {
  phone?: string | null;
  whatsapp_user_id?: string | null;
}

/**
 * Resolves the identifier accepted by the current WhatsApp Cloud API. A
 * BSUID is deliberately preferred: usernames can change and a phone may be
 * unavailable for username-based conversations.
 */
export function resolveWhatsAppRecipient(
  contact: WhatsAppContactIdentity
): WhatsAppRecipient | null {
  const bsuid = contact.whatsapp_user_id?.trim();
  if (bsuid) return { type: 'bsuid', value: bsuid };

  const phone = sanitizePhoneForMeta(contact.phone ?? '');
  if (isValidE164(phone)) return { type: 'phone', value: phone };

  return null;
}
