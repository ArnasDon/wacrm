// ============================================================
// What to do about a failed campaign send.
//
// Every error a template send can raise — Meta error codes, HTTP
// status, network / timeout failures, our own validation — maps to one
// action, so the senders (in-process runner, Kafka worker) never guess:
//
//   throttle   slow this channel down, then retry the same recipient
//   retry      transient (5xx, connect failure): back off and retry
//   template   this template can't be sent on this WABA → next template
//   channel    this channel can't send at all → stop it, re-route
//   recipient  this recipient can't get it → mark failed, move on
//   unknown    the request may have reached Meta (timeout / reset after
//              sending): do NOT retry (could double-send), mark failed
//
// Codes: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
// ============================================================

import { MetaApiError } from '@/lib/whatsapp/meta-api';
import {
  TEMPLATE_UNAVAILABLE_CODES,
  isTemplateUnavailable,
} from '@/lib/campaigns/advanced';

export type SendAction =
  'throttle' | 'retry' | 'template' | 'channel' | 'recipient' | 'unknown';

export interface ClassifiedError {
  action: SendAction;
  code: number | null;
  /** "[code] message: details" — what the Logs tab shows / groups by. */
  text: string;
  /** Suggested wait before retrying (throttle / retry). */
  retryAfterMs?: number;
  /**
   * Meta answered with an API error (its `error` object, e.g. code
   * 135000). False for our own validation, network failures and
   * ambiguous timeouts — "Stop on Meta API error" acts only on these.
   */
  fromMeta: boolean;
}

/** Throughput / rate limits — slow down and retry. */
const THROTTLE_CODES = new Map<number, number>([
  [130429, 1_000], // Cloud API throughput reached for the number
  [131048, 10_000], // spam rate limit hit
  [80007, 5_000], // WABA rate limit
  [4, 10_000], // app-level API call limit
  [17, 10_000], // user-level API call limit
  [32, 10_000], // page-level call limit
  [613, 10_000], // calls within the last hour exceeded
]);

/** The channel (number / WABA / token) can't send. */
const CHANNEL_CODES = new Set([
  190, // access token expired / invalid
  10, // permission denied
  200, // permission error
  3, // capability / permission
  368, // temporarily blocked for policy violations
  131031, // business account locked
  131042, // payment issue on the account
  131045, // phone number not registered / certificate
  133010, // phone number not registered
  133005, // two-step PIN mismatch
  2388103, // phone number deregistered
]);

/** Transient on Meta's side — safe to retry. */
const RETRY_CODES = new Set([
  1, // unknown error
  2, // service temporarily unavailable
  131000, // something went wrong
  131016, // service unavailable
  131057, // business account in maintenance mode
  133004, // server temporarily unavailable for this number
]);

/** Low-level errors raised before anything reached Meta. */
const CONNECT_ERRORS =
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|ENETUNREACH|EHOSTUNREACH/;
/** Errors after the request may have been sent — outcome unknown. */
const AMBIGUOUS_ERRORS =
  /ECONNRESET|EPIPE|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|TimeoutError|aborted|other side closed|terminated/i;

function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  const extra = cause?.code ?? cause?.message;
  return extra && !err.message.includes(extra)
    ? `${err.message} (${extra})`
    : err.message;
}

export function classifySendError(err: unknown): ClassifiedError {
  if (err instanceof MetaApiError) {
    const code = err.code;
    // An error response from Meta (its error object / HTTP error) — not
    // a 200 that merely lacked an id.
    const fromMeta = code != null || err.httpStatus >= 400;
    const detail =
      err.details && !err.message.includes(err.details)
        ? `: ${err.details}`
        : '';
    const text =
      code != null
        ? `[${code}] ${err.message}${detail}`
        : `${err.message}${detail}`;

    if (code != null && THROTTLE_CODES.has(code)) {
      return {
        action: 'throttle',
        code,
        text,
        retryAfterMs: THROTTLE_CODES.get(code),
        fromMeta,
      };
    }
    if (err.httpStatus === 429)
      return { action: 'throttle', code, text, retryAfterMs: 2_000, fromMeta };
    if (code != null && TEMPLATE_UNAVAILABLE_CODES.has(code))
      return { action: 'template', code, text, fromMeta };
    if (isTemplateUnavailable(code, err.message))
      return { action: 'template', code, text, fromMeta };
    if (code != null && CHANNEL_CODES.has(code))
      return { action: 'channel', code, text, fromMeta };
    if (code != null && RETRY_CODES.has(code))
      return { action: 'retry', code, text, retryAfterMs: 1_000, fromMeta };
    if (err.httpStatus >= 500)
      return { action: 'retry', code, text, retryAfterMs: 1_000, fromMeta };
    // 131026 undeliverable, 131047 24h window, 131049 marketing limit,
    // 131050 user opted out, 131056 pair rate limit, 100 / 131008 /
    // 131009 / 132000 / 132012 bad parameters, … — this recipient only.
    return { action: 'recipient', code, text, fromMeta };
  }

  const message = describe(err);
  if (CONNECT_ERRORS.test(message)) {
    return {
      action: 'retry',
      code: null,
      text: `Network error: ${message}`,
      retryAfterMs: 1_000,
      fromMeta: false,
    };
  }
  if (
    AMBIGUOUS_ERRORS.test(message) ||
    (err instanceof Error && err.name === 'TimeoutError')
  ) {
    return {
      action: 'unknown',
      code: null,
      text: `No response from Meta (${message}) — not retried in case it was delivered`,
      fromMeta: false,
    };
  }
  // Our own validation (missing variable, bad media link…) or anything else.
  return {
    action: 'recipient',
    code: null,
    text: message || 'Unknown error',
    fromMeta: false,
  };
}
