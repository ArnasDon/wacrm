/**
 * WhatsApp Business Calling — inbound webhook event reducer.
 *
 * Meta delivers call lifecycle events on the `calls` change.field once
 * the app is subscribed to it. This module owns the PURE mapping from a
 * Meta call event → the `call_logs` row fields to upsert. It does no
 * I/O: the webhook route resolves the contact/conversation and persists
 * the result, so this reducer stays trivially unit-testable.
 *
 * Status lifecycle (v1 = inbound / user-initiated):
 *   connect            -> ringing   (+ store the customer's SDP offer)
 *   terminate (talked) -> completed (+ ended_at, duration_seconds)
 *   terminate (else)   -> missed | declined | failed
 *
 * Field names follow Meta's Cloud API Calling webhook. They are kept
 * defensive (optional, with fallbacks) because Meta has iterated on the
 * exact shape during the API's rollout — re-verify against a live
 * payload before relying on any single field.
 */

export type CallDirection = 'inbound' | 'outbound'

export type CallStatus =
  | 'initiated'
  | 'ringing'
  | 'connected'
  | 'completed'
  | 'missed'
  | 'declined'
  | 'failed'

/** A single entry in the webhook `value.calls[]` array. */
export interface WhatsAppCallEvent {
  /** Meta's call id (`wacid...`). Our idempotency key. */
  id: string
  /** Customer's wa_id (E.164, no '+'). */
  from: string
  /** Business display phone number. */
  to?: string
  /** Lifecycle event. */
  event?: 'connect' | 'terminate' | string
  /** Unix seconds (string), as everywhere else in the webhook. */
  timestamp?: string
  direction?: 'USER_INITIATED' | 'BUSINESS_INITIATED' | string
  /** Present on `connect` for user-initiated calls — the SDP offer. */
  session?: { sdp_type?: 'offer' | 'answer'; sdp?: string }
  /** Some deliveries carry an explicit status string. */
  status?: string
  /** Termination reason / call-status detail. */
  status_info?: { reason?: string } | string
  /** Seconds, present on some `terminate` events. */
  duration?: number
}

/** Subset of an existing `call_logs` row the reducer needs to make decisions. */
export interface ExistingCallRow {
  status: CallStatus
  started_at?: string | null
  answered_at?: string | null
}

/** The column patch to upsert onto `call_logs`. */
export interface CallLogPatch {
  meta_call_id: string
  direction: CallDirection
  status: CallStatus
  offer_sdp?: string | null
  sdp_type?: 'offer' | 'answer' | null
  started_at?: string
  ended_at?: string
  duration_seconds?: number | null
  end_reason?: string | null
}

function isoFromUnix(ts: string | undefined, fallbackIso: string): string {
  if (!ts) return fallbackIso
  const n = parseInt(ts, 10)
  if (!Number.isFinite(n)) return fallbackIso
  return new Date(n * 1000).toISOString()
}

function endReasonOf(event: WhatsAppCallEvent): string | null {
  if (typeof event.status_info === 'string') return event.status_info
  if (event.status_info?.reason) return event.status_info.reason
  if (event.status) return event.status
  return null
}

/**
 * Map a `terminate` event to a terminal status. If the call had been
 * answered (we were `connected`) it `completed`; otherwise the reason
 * string decides missed vs declined vs failed.
 */
function terminalStatus(
  event: WhatsAppCallEvent,
  existing: ExistingCallRow | null
): CallStatus {
  if (existing?.status === 'connected' || existing?.answered_at) return 'completed'
  const reason = (endReasonOf(event) ?? '').toLowerCase()
  if (reason.includes('reject') || reason.includes('declin') || reason.includes('busy')) {
    return 'declined'
  }
  if (reason.includes('fail') || reason.includes('error') || reason.includes('unavailable')) {
    return 'failed'
  }
  // No answer / cancelled / timed out → missed.
  return 'missed'
}

/**
 * Reduce a Meta call webhook event into the `call_logs` patch to upsert.
 *
 * @param event    the `value.calls[i]` entry
 * @param existing the current row (null on first sight of this call)
 * @param nowIso   injected clock (keeps the reducer pure/testable)
 */
export function reduceCallEvent(
  event: WhatsAppCallEvent,
  existing: ExistingCallRow | null,
  nowIso: string
): CallLogPatch {
  const direction: CallDirection =
    event.direction === 'BUSINESS_INITIATED' ? 'outbound' : 'inbound'

  const base: CallLogPatch = {
    meta_call_id: event.id,
    direction,
    status: existing?.status ?? 'ringing',
  }

  if (event.event === 'terminate') {
    const startedIso = existing?.started_at ?? isoFromUnix(event.timestamp, nowIso)
    const endedIso = isoFromUnix(event.timestamp, nowIso)
    let duration: number | null = null
    if (typeof event.duration === 'number' && Number.isFinite(event.duration)) {
      duration = Math.max(0, Math.round(event.duration))
    } else if (existing?.answered_at) {
      duration = Math.max(
        0,
        Math.round((Date.parse(endedIso) - Date.parse(existing.answered_at)) / 1000)
      )
    }
    return {
      ...base,
      status: terminalStatus(event, existing),
      ended_at: endedIso,
      duration_seconds: duration,
      end_reason: endReasonOf(event),
      // started_at only set if the row is being created by this event
      // (terminate arriving with no prior connect — e.g. very short call).
      ...(existing ? {} : { started_at: startedIso }),
    }
  }

  // `connect` (or first sight): the call is ringing for an agent to answer.
  // Capture the SDP offer so the softphone can answer it.
  return {
    ...base,
    status: existing?.status === 'connected' ? 'connected' : 'ringing',
    offer_sdp: event.session?.sdp ?? null,
    sdp_type: event.session?.sdp_type ?? (event.session?.sdp ? 'offer' : null),
    started_at: existing?.started_at ?? isoFromUnix(event.timestamp, nowIso),
  }
}
