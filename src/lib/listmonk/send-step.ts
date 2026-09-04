import { sendTransactional } from './client';
import { isSyncableEmail } from './sync';

// ============================================================
// The one "send an email to this contact" primitive that BOTH the
// automation engine and the flow engine call.
//
// Kept engine-agnostic on purpose: it takes a contact row and a
// template id and returns a short human-readable result string, the
// same contract as the engines' other step handlers. Neither engine
// needs to know listmonk exists.
// ============================================================

export interface EmailableContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string;
  company?: string | null;
}

export interface SendEmailStepInput {
  contact: EmailableContact;
  templateId: number;
  /** Already-interpolated subject override, if the step set one. */
  subject?: string;
  /** Flow/automation variables — exposed to the template as
   *  `{{ .Tx.Data.vars.<key> }}`. */
  vars?: Record<string, unknown>;
  /** Inbound message text, when the trigger was a message. */
  messageText?: string;
}

/**
 * Thrown when the contact simply cannot receive email. Callers treat
 * this as a SKIP (logged, non-fatal), distinct from a delivery
 * failure — a WhatsApp-only contact hitting an email step is an
 * expected situation, not an error in the automation.
 */
export class NoEmailAddressError extends Error {
  constructor(contactId: string) {
    super(`contact ${contactId} has no usable email address`);
    this.name = 'NoEmailAddressError';
  }
}

/**
 * What the template sees as `.Tx.Data`. Pure so it can be unit-tested
 * without a running listmonk.
 *
 * Shape is deliberately flat-ish and stable: templates written today
 * (`{{ .Tx.Data.contact.name }}`) must keep working after this file
 * grows.
 */
export function buildTxData(
  input: SendEmailStepInput
): Record<string, unknown> {
  const { contact } = input;
  return {
    contact: {
      id: contact.id,
      name: contact.name ?? '',
      first_name: firstName(contact.name),
      email: (contact.email ?? '').trim().toLowerCase(),
      phone: contact.phone,
      company: contact.company ?? '',
    },
    vars: input.vars ?? {},
    ...(input.messageText !== undefined
      ? { message: { text: input.messageText } }
      : {}),
    source: 'wacrm',
  };
}

/** "Jane Doe" → "Jane"; null → "". */
export function firstName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0];
}

/**
 * Send one transactional email to a contact.
 *
 * Returns the result string the engines record in their logs.
 * Throws NoEmailAddressError for contacts that cannot be emailed;
 * throws ListmonkError (from the client) for real delivery problems.
 */
export async function sendEmailToContact(
  input: SendEmailStepInput
): Promise<string> {
  const email = (input.contact.email ?? '').trim().toLowerCase();
  if (!isSyncableEmail(email)) {
    throw new NoEmailAddressError(input.contact.id);
  }
  if (!Number.isInteger(input.templateId) || input.templateId < 1) {
    throw new Error('send_email needs a template');
  }

  await sendTransactional({
    template_id: input.templateId,
    email,
    data: buildTxData(input),
    ...(input.subject?.trim() ? { subject: input.subject.trim() } : {}),
  });

  return `email sent to ${email} (template ${input.templateId})`;
}
