// ============================================================
// Outbound webhook event vocabulary — pure, no I/O.
//
// An endpoint subscribes to one or more of these. Adding an event is
// one entry here plus a `dispatchWebhookEvent` call at the source of
// the event (the DB stores subscriptions as a free `text[]`, so no
// migration is needed — same model as API scopes).
// ============================================================

export const WEBHOOK_EVENTS = [
  'message.received', // an inbound WhatsApp message landed
  'message.status_updated', // a sent message advanced (sent/delivered/read)
  'conversation.created', // a new conversation was opened for a contact
  'conversation.closed', // a conversation was marked closed (agent, AI action, or automation)
  'contact.created', // a new contact/lead was created
  'contact.lead_temperature_changed', // a contact's cold/warm/hot classification changed
  'deal.stage_changed', // a deal moved to a different pipeline stage
  'deal.won', // a deal landed on a stage marked "Venta cerrada" (is_won)
  'broadcast.completed', // a broadcast campaign reached a terminal status (sent/failed)
  'quote.created', // a quote was created (human or the AI's create_quote action)
  'appointment.scheduled', // a Google Calendar appointment was created for a contact
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Human-readable descriptions (surfaced in docs / a future UI). */
export const WEBHOOK_EVENT_DESCRIPTIONS: Record<WebhookEvent, string> = {
  'message.received': 'An inbound message was received from a contact',
  'message.status_updated':
    'A message you sent changed delivery status (sent/delivered/read/failed)',
  'conversation.created': 'A new conversation was opened',
  'conversation.closed': 'A conversation was marked closed',
  'contact.created': 'A new contact/lead was created',
  'contact.lead_temperature_changed': "A contact's temperature (cold/warm/hot) changed",
  'deal.stage_changed': 'A deal moved to a different pipeline stage',
  'deal.won': 'A deal reached a "Venta cerrada" (closed-won) stage',
  'broadcast.completed': 'A broadcast campaign finished sending',
  'quote.created': 'A quote was created for a contact',
  'appointment.scheduled': 'A Google Calendar appointment was scheduled for a contact',
};

/** Type-narrow an unknown value into a valid `WebhookEvent`. */
export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return (
    typeof value === 'string' &&
    (WEBHOOK_EVENTS as readonly string[]).includes(value)
  );
}

/**
 * Validate + de-duplicate a caller-supplied event list. Returns the
 * cleaned list, or `null` if any entry is unknown (callers turn that
 * into a 400). An empty list is rejected as `null` too — an endpoint
 * subscribed to nothing is almost certainly a mistake.
 */
export function normalizeEvents(input: unknown): WebhookEvent[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: WebhookEvent[] = [];
  for (const entry of input) {
    if (!isWebhookEvent(entry)) return null;
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}
