/**
 * Turn a Meta Graph API failure into something a person can act on.
 *
 * Meta's error envelope is precise but terse — "(#100) Unsupported get
 * request" says nothing about *which* of the four values on the settings
 * form is wrong. This module maps `code` / `error_subcode` (plus the
 * step of the connect flow that failed) onto: a plain-English summary,
 * the form field to check, and whether the fix is on the user's side
 * (HTTP 400) or Meta's (HTTP 502). The raw code, subcode and
 * `fbtrace_id` ride along so the user can quote them to Meta support.
 *
 * Pure — no I/O, no env. Issue #505.
 *
 * Error codes: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */

/** Which call of the connect flow failed. */
export type MetaConnectStep =
  | 'verify_number'
  | 'waba_phone_numbers'
  | 'register'
  | 'subscribe_waba'
  | 'subscribed_apps'

/** The settings-form field (or external place) the user should look at. */
export type MetaErrorField =
  | 'access_token'
  | 'phone_number_id'
  | 'waba_id'
  | 'pin'
  | 'meta_account'
  | null

/**
 * Structural shape of `MetaApiError` from ./meta-api — declared here so
 * this module stays free of I/O imports and so callers can feed it any
 * object carrying Meta's envelope fields.
 */
export interface MetaErrorLike {
  message: string
  code?: number | null
  subcode?: number | null
  type?: string | null
  fbtraceId?: string | null
  httpStatus?: number | null
  details?: string | null
}

export interface MetaErrorExplanation {
  /** Actionable, user-facing text. */
  summary: string
  field: MetaErrorField
  /** Who has to change something. Drives the HTTP status. */
  side: 'user' | 'meta'
  httpStatus: 400 | 502
  step: MetaConnectStep
  code: number | null
  subcode: number | null
  fbtraceId: string | null
  /** Meta's own message (with `error_data.details` appended when present). */
  metaMessage: string
}

/** Values the caller already knows — quoted back so the text names the id that failed. */
export interface MetaErrorContext {
  phoneNumberId?: string | null
  wabaId?: string | null
}

const STEP_LABEL: Record<MetaConnectStep, string> = {
  verify_number: 'reading the phone number',
  waba_phone_numbers: 'listing the phone numbers under the WhatsApp Business Account',
  register: 'registering the phone number',
  subscribe_waba: 'subscribing the WhatsApp Business Account to the app',
  subscribed_apps: 'reading the WhatsApp Business Account subscriptions',
}

const TOKEN_HINT =
  'Generate a permanent token in Meta Business Settings → System Users → Generate token, ' +
  'with the whatsapp_business_management and whatsapp_business_messaging permissions, ' +
  'and paste it into Permanent Access Token.'

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80007, 130429, 131048, 131056])
const TEMPORARY_CODES = new Set([1, 2, 131000, 133004, 133016])

function isMetaErrorLike(err: unknown): err is MetaErrorLike {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { message?: unknown }).message === 'string' &&
    ('code' in err || 'fbtraceId' in err || 'httpStatus' in err)
  )
}

/** Which id the failing step was addressing — and the field it lives in. */
function objectForStep(
  step: MetaConnectStep,
  ctx: MetaErrorContext,
): { field: MetaErrorField; noun: string; id: string | null } {
  if (step === 'verify_number' || step === 'register') {
    return { field: 'phone_number_id', noun: 'Phone Number ID', id: ctx.phoneNumberId ?? null }
  }
  return { field: 'waba_id', noun: 'WhatsApp Business Account ID', id: ctx.wabaId ?? null }
}

function withId(noun: string, id: string | null): string {
  return id ? `${noun} ${id}` : `the ${noun}`
}

/**
 * Explain any error thrown while talking to Meta during the connect flow.
 * Non-Meta errors (network failures, unexpected throws) get a generic
 * Meta-side explanation so the route never has to special-case them.
 */
export function explainMetaError(
  err: unknown,
  step: MetaConnectStep,
  ctx: MetaErrorContext = {},
): MetaErrorExplanation {
  if (!isMetaErrorLike(err)) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      summary:
        `Could not reach the Meta Graph API while ${STEP_LABEL[step]}: ${message}. ` +
        'Check that this server has outbound internet access to graph.facebook.com and try again.',
      field: null,
      side: 'meta',
      httpStatus: 502,
      step,
      code: null,
      subcode: null,
      fbtraceId: null,
      metaMessage: message,
    }
  }

  const code = err.code ?? null
  const subcode = err.subcode ?? null
  const fbtraceId = err.fbtraceId ?? null
  const metaMessage = err.details ? `${err.message} (${err.details})` : err.message
  const target = objectForStep(step, ctx)

  const build = (
    summary: string,
    field: MetaErrorField,
    side: 'user' | 'meta',
  ): MetaErrorExplanation => ({
    summary,
    field,
    side,
    httpStatus: side === 'user' ? 400 : 502,
    step,
    code,
    subcode,
    fbtraceId,
    metaMessage,
  })

  // --- Access token -----------------------------------------------------
  if (code === 190 || (code === null && err.type === 'OAuthException')) {
    const why =
      subcode === 463
        ? 'The access token has expired.'
        : subcode === 460 || subcode === 467
          ? 'The access token has been invalidated (password change, revoked session, or token reset).'
          : 'Meta rejected the access token as invalid.'
    return build(
      `${why} Temporary tokens from the API Setup page expire after 24 hours. ${TOKEN_HINT}`,
      'access_token',
      'user',
    )
  }

  // --- Permissions --------------------------------------------------------
  if (code === 10 || (code !== null && code >= 200 && code <= 299)) {
    return build(
      `The access token is not allowed to perform this action (${STEP_LABEL[step]}). ` +
        'Its System User needs the whatsapp_business_management and whatsapp_business_messaging ' +
        'permissions AND must be assigned to this WhatsApp Business Account ' +
        '(Business Settings → System Users → Add assets → WhatsApp accounts). Then generate a new token.',
      'access_token',
      'user',
    )
  }

  if (code === 131005) {
    return build(
      `Meta denied access while ${STEP_LABEL[step]}: the business that owns the token cannot manage ` +
        `${withId(target.noun, target.id)}. Assign the System User to this WhatsApp Business Account ` +
        'in Business Settings and make sure the token has whatsapp_business_management.',
      'access_token',
      'user',
    )
  }

  // --- Wrong / foreign object ids ----------------------------------------
  const looksLikeMissingObject =
    code === 33 ||
    (code === 100 && subcode === 33) ||
    (code === 100 &&
      /unsupported (get|post) request|does not exist|cannot be loaded due to missing permissions|unknown path components/i.test(
        err.message,
      ))
  if (looksLikeMissingObject) {
    return build(
      `Meta cannot find ${withId(target.noun, target.id)}, or the business that owns the access token ` +
        `does not own it. Copy the ${target.noun} exactly from Meta → WhatsApp → API Setup and check the ` +
        'token was generated inside the same Business portfolio.',
      target.field,
      'user',
    )
  }

  if (code === 100) {
    if (step === 'register' && /pin/i.test(err.message)) {
      return build(
        `Meta rejected the two-step verification PIN: ${err.message}. Enter the 6-digit PIN set in ` +
          'WhatsApp Manager → Phone numbers → Two-step verification.',
        'pin',
        'user',
      )
    }
    return build(
      `Meta rejected a parameter while ${STEP_LABEL[step]}: ${err.message}. Check that the ` +
        `${target.noun} is copied exactly (digits only, no spaces).`,
      target.field,
      'user',
    )
  }

  // --- Registration / PIN --------------------------------------------------
  if (code === 133010) {
    return build(
      'This phone number is not registered with the WhatsApp Cloud API yet. Enter the two-step ' +
        'verification PIN below and save again so wacrm can register it (POST /register).',
      'pin',
      'user',
    )
  }
  if (code === 133005 || code === 136025) {
    return build(
      'The two-step verification PIN is wrong. Use the 6-digit PIN set in WhatsApp Manager → ' +
        'Phone numbers → Two-step verification (or reset it there), then save again.',
      'pin',
      'user',
    )
  }
  if (code === 133008 || code === 133009) {
    return build(
      'Meta has temporarily locked PIN attempts for this number after too many wrong guesses. ' +
        'Wait a while before saving again with the correct PIN.',
      'pin',
      'meta',
    )
  }
  if (code === 133006) {
    return build(
      'Meta requires this phone number to be re-verified. Open WhatsApp Manager → Phone numbers, ' +
        'complete verification (SMS or voice), then save again.',
      'meta_account',
      'meta',
    )
  }
  if (code === 133015) {
    return build(
      'This phone number was recently deleted from WhatsApp and cannot be registered yet. ' +
        'Meta blocks re-registration for a period after deletion — try again later.',
      'meta_account',
      'meta',
    )
  }

  // --- Account state ------------------------------------------------------
  if (code === 131031) {
    return build(
      'Meta has restricted or locked this WhatsApp Business Account, so nothing in wacrm can ' +
        'connect it. Open Meta Business Manager → Account quality (or WhatsApp Manager → Overview) ' +
        'to see the restriction and appeal it.',
      'meta_account',
      'meta',
    )
  }
  if (code === 368) {
    return build(
      'Meta has temporarily blocked this account for a policy violation. Review the notice in ' +
        'Meta Business Manager → Account quality; the block lifts on its own or after an appeal.',
      'meta_account',
      'meta',
    )
  }

  // --- Throttling / transient ------------------------------------------------
  if (RATE_LIMIT_CODES.has(code ?? -1)) {
    return build(
      'Meta is rate-limiting this app or WhatsApp Business Account right now. Nothing needs ' +
        'changing — wait a few minutes and try again.',
      null,
      'meta',
    )
  }
  if (TEMPORARY_CODES.has(code ?? -1)) {
    return build(
      `Meta returned a temporary error while ${STEP_LABEL[step]} (code ${code}). Retry in a minute; ` +
        'if it keeps happening, check metastatus.com and quote the trace id to Meta support.',
      null,
      'meta',
    )
  }

  // --- Fallback: keep Meta's words -------------------------------------------
  const trace = fbtraceId ? ` Trace id ${fbtraceId}.` : ''
  const codeText = code !== null ? ` (code ${code}${subcode !== null ? `/${subcode}` : ''})` : ''
  return build(
    `Meta returned an error while ${STEP_LABEL[step]}${codeText}: ${metaMessage}.${trace}`,
    null,
    'meta',
  )
}

/**
 * The `meta` object POST /api/whatsapp/config attaches to every failed
 * Meta call — everything a user needs to quote to support.
 */
export function metaErrorPayload(x: MetaErrorExplanation): {
  code: number | null
  subcode: number | null
  fbtrace_id: string | null
  step: MetaConnectStep
  field: MetaErrorField
  message: string
} {
  return {
    code: x.code,
    subcode: x.subcode,
    fbtrace_id: x.fbtraceId,
    step: x.step,
    field: x.field,
    message: x.metaMessage,
  }
}
