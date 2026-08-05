// ============================================================
// Máquina de estados de pipelines — capa de VALIDACIÓN (pura).
// Spec: docs/analytics.md §7.1 (Item 5 del plan §13).
//
// `evaluateTransition` replica en TypeScript la lógica de guard_rules
// que `transition_deal` (047_analytics.sql:235-317) ejecuta en SQL:
//   - required_evidence: cada item debe existir como evento en el
//     timeline del deal (tracking_events.event_type + payload.deal_id).
//   - allow_override=false → la transición queda BLOQUEADA si falta
//     evidencia (hard guard); true/ausente → checklist no-bloqueante.
//
// El UI usa esto para mostrar el checklist ANTES de llamar a la RPC
// (feedback inmediato con missing[]/warnings[]). La RPC sigue siendo la
// autoridad: sin ella no hay transición (guardrail 2c, DAD §7.1).
//
// NOTA: este módulo NO ejecuta cambios — solo evalúa y devuelve el
// veredicto + checklist. Quien llama (page.tsx / deal-form.tsx) decide.
// ============================================================

export interface GuardRules {
  /** Eventos requeridos en el timeline (tracking_events.event_type). */
  required_evidence?: string[]
  /** false = hard guard: sin evidencia no hay transición (ni override). */
  allow_override?: boolean
  /** Opcional: mensaje humano para el UI. */
  hint?: string
}

export interface PipelineStageLike {
  id: string
  name: string
  guard_rules?: GuardRules | null
}

export interface DealLike {
  id: string
  stage_id: string
  status: 'open' | 'won' | 'lost'
  version: number
  score?: number
  tags?: Record<string, unknown> | null
  priority?: string
  won_at?: string | null
  lost_at?: string | null
}

/** Evento del timeline: lo mínimo que necesita el checker de evidencia. */
export interface TimelineEvidence {
  event_type: string
  deal_id?: string | null
}

export interface TransitionVerdict {
  allowed: boolean
  /** Evidencia requerida que falta (checklist para el UI). */
  missing: string[]
  /** Advertencias no bloqueantes (info adicional para el agente). */
  warnings: string[]
  /** Código máquina (mismo vocabulario que transition_deal). */
  code: 'ALLOWED' | 'GUARDS_MISSING' | 'HARD_GUARD' | 'NO_STAGE'
  /** Mensaje humano para toast. */
  hint?: string
}

/**
 * Estado objetivo: cuando el stage destino es terminal (status won/lost),
 * la transición además cambia el status — el checker lo comunica como
 * warning si no se pasa p_new_status.
 */
export interface EvaluateTransitionInput {
  deal: DealLike
  toStage: PipelineStageLike
  /** Eventos del timeline del deal (filtrados por deal_id). */
  evidence: TimelineEvidence[]
  /** Status destino cuando la transición es terminal (won/lost). */
  newStatus?: 'won' | 'lost' | 'open'
}

const EMPTY: TimelineEvidence[] = []

export function evaluateTransition(input: EvaluateTransitionInput): TransitionVerdict {
  const { deal, toStage, newStatus } = input
  const evidence = input.evidence ?? EMPTY
  const rules = toStage.guard_rules ?? {}

  // Veredicto base: el deal existe y el stage también → se puede evaluar.
  if (!toStage.id || !deal.id) {
    return {
      allowed: false,
      missing: [],
      warnings: [],
      code: 'NO_STAGE',
      hint: 'no se pudo evaluar la transición: faltan datos de deal o stage',
    }
  }

  const missing: string[] = []
  const warnings: string[] = []

  // No-op (mismo stage y mismo status) — lo reporta la RPC como NO_OP.
  if (deal.stage_id === toStage.id && (newStatus ?? deal.status) === deal.status) {
    warnings.push('la transición no cambia nada (mismo stage y status)')
  }

  // Guard: evidencia requerida presente en el timeline.
  if (rules.required_evidence?.length) {
    for (const required of rules.required_evidence) {
      const found = evidence.some((e) => e.event_type === required)
      if (!found) missing.push(required)
    }
  }

  // Status terminal sin p_new_status explícito → warning (el default 'open'
  // en la RPC no marcaría won/lost; el caller debe pasarlo).
  const statusChangedToTerminal =
    (newStatus === 'won' || newStatus === 'lost') &&
    deal.status !== newStatus
  if (statusChangedToTerminal) {
    if (newStatus === 'won' && !deal.won_at) warnings.push('se marcará won_at con la fecha actual')
    if (newStatus === 'lost' && !deal.lost_at) warnings.push('se marcará lost_at con la fecha actual')
  }

  // Veredicto final.
  if (missing.length > 0) {
    if (rules.allow_override === false) {
      return {
        allowed: false,
        missing,
        warnings,
        code: 'HARD_GUARD',
        hint: rules.hint ?? 'evidencia requerida faltante y el override está deshabilitado',
      }
    }
    return {
      allowed: false,
      missing,
      warnings,
      code: 'GUARDS_MISSING',
      hint: rules.hint ?? 'evidencia requerida faltante; puedes avanzar con override + razón (no-bloqueante)',
    }
  }

  return { allowed: true, missing: [], warnings, code: 'ALLOWED' }
}

/** Pasa un `missing[]` a un mensaje corto para toast (es, no-sé). */
export function missingToMessage(missing: string[]): string {
  if (missing.length === 0) return ''
  const names = missing.map((m) => m.replace(/_/g, ' ')).join(', ')
  return `falta evidencia: ${names}`
}
