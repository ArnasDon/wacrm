// ============================================================
// CSAT — pure helpers (no I/O). Shared by the config route, the
// dispatch/capture hooks, the cron sweep, and their unit tests.
// ============================================================

export const CSAT_SCALES = [3, 5] as const
export type CsatScale = (typeof CSAT_SCALES)[number]

export const CSAT_DELAY_MIN_MINUTES = 0
/** 14 days — matches the migration's CHECK. */
export const CSAT_DELAY_MAX_MINUTES = 20_160
export const CSAT_COOLDOWN_MIN_DAYS = 0
export const CSAT_COOLDOWN_MAX_DAYS = 365

export function clampScale(v: unknown): CsatScale {
  const n = Math.floor(Number(v))
  return (CSAT_SCALES as readonly number[]).includes(n) ? (n as CsatScale) : 5
}

export function clampDelayMinutes(v: unknown): number {
  let n = Math.floor(Number(v))
  if (!Number.isFinite(n)) n = 1440
  return Math.min(CSAT_DELAY_MAX_MINUTES, Math.max(CSAT_DELAY_MIN_MINUTES, n))
}

export function clampCooldownDays(v: unknown): number {
  let n = Math.floor(Number(v))
  if (!Number.isFinite(n)) n = 30
  return Math.min(CSAT_COOLDOWN_MAX_DAYS, Math.max(CSAT_COOLDOWN_MIN_DAYS, n))
}

export interface NormalizedCsatConfig {
  enabled: boolean
  template_name: string | null
  template_language: string | null
  scale: CsatScale
  delay_minutes: number
  cooldown_days: number
}

/**
 * Normalize a raw settings-form body into the columns we persist. A
 * template name is required only when `enabled` is true — an account
 * can save "off" with nothing else filled in.
 */
export function normalizeCsatConfigInput(
  body: Record<string, unknown>,
): { ok: true; value: NormalizedCsatConfig } | { ok: false; error: string } {
  const enabled = body.enabled === true
  const template_name =
    typeof body.template_name === 'string' && body.template_name.trim()
      ? body.template_name.trim()
      : null
  const template_language =
    typeof body.template_language === 'string' && body.template_language.trim()
      ? body.template_language.trim()
      : null

  if (enabled && !template_name) {
    return { ok: false, error: 'Elige una plantilla de WhatsApp antes de activar la encuesta.' }
  }

  return {
    ok: true,
    value: {
      enabled,
      template_name,
      template_language,
      scale: clampScale(body.scale),
      delay_minutes: clampDelayMinutes(body.delay_minutes),
      cooldown_days: clampCooldownDays(body.cooldown_days),
    },
  }
}

const CSAT_KEYWORD_RE = /(?:csat|score|rating|nps|puntaje|calificaci[oó]n)[\s_:.\-]*(\d{1,2})/i
const STANDALONE_INT_RE = /(?:^|[^\d])(\d{1,2})(?:[^\d]|$)/

/**
 * Recover the numeric rating a customer tapped from the button's
 * stable id (`interactive_reply_id`) and/or its visible label. Handles
 * bare digits ("5"), prefixed payloads ("csat_5", "rating:4"),
 * embedded digits ("5 - Excelente", "Muy bueno (4)") and star strings
 * ("★★★★★"). Returns an int in `[1, scale]`, or null when nothing
 * plausible is found.
 */
export function parseScoreFromReply(
  replyId: string | null | undefined,
  text: string | null | undefined,
  scale: number,
): number | null {
  const candidates = [replyId, text].filter(
    (s): s is string => typeof s === 'string' && s.trim().length > 0,
  )

  for (const raw of candidates) {
    const s = raw.trim()

    // 1. Exact integer.
    if (/^\d{1,2}$/.test(s)) {
      const n = Number(s)
      if (n >= 1 && n <= scale) return n
    }

    // 2. Prefixed payload: csat_5 / rating:4 / score-3.
    const kw = s.match(CSAT_KEYWORD_RE)
    if (kw) {
      const n = Number(kw[1])
      if (n >= 1 && n <= scale) return n
    }

    // 3. Star string — count the stars.
    const stars = (s.match(/[★⭐✩✪]/gu) ?? []).length
    if (stars >= 1 && stars <= scale) return stars

    // 4. First standalone 1–2 digit run anywhere in the string.
    const any = s.match(STANDALONE_INT_RE)
    if (any) {
      const n = Number(any[1])
      if (n >= 1 && n <= scale) return n
    }
  }

  return null
}
