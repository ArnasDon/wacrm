// ============================================================
// Etapas por defecto de un pipeline nuevo.
//
// Antes vivían como una constante dentro de `pipelines/page.tsx` —un
// componente de cliente no es sitio para la definición del producto— y eran
// cuatro nombres genéricos sin ninguna regla. Aquí son doce etapas con su
// estado terminal y sus guardas.
//
// Las etapas siguen siendo editables por el usuario: esto es el punto de
// partida, no una jaula.
// ============================================================

/** Reglas de guarda de una etapa (el jsonb `pipeline_stages.guard_rules`). */
export interface StageGuardRules {
  /** Evidencia que debe existir antes de entrar en la etapa. */
  required_evidence?: string[];
  /**
   * false = muro: sin evidencia no hay transición ni con motivo.
   * En el seed SIEMPRE va true — ver la nota de abajo.
   */
  allow_override?: boolean;
  /** Texto humano que el UI enseña junto a la lista de lo que falta. */
  hint?: string;
}

export interface DefaultStage {
  name: string;
  color: string;
  position: number;
  /** Estado del trato al entrar en la etapa. Lo consume `transition_deal`. */
  stage_status: 'open' | 'won' | 'lost';
  guard_rules: StageGuardRules | null;
}

/**
 * Las guardas son una LISTA DE VERIFICACIÓN, no un muro: `allow_override` es
 * `true` en todas. El agente avanza igual y el motivo queda auditado en el
 * evento `state_changed`. Un CRM que bloquea al vendedor se deja de usar en
 * una semana.
 */
export const DEFAULT_STAGES: readonly DefaultStage[] = [
  {
    name: 'Lead creado',
    color: '#94a3b8',
    position: 0,
    stage_status: 'open',
    guard_rules: null,
  },
  {
    name: 'Contacto intentado',
    color: '#64748b',
    position: 1,
    stage_status: 'open',
    guard_rules: null,
  },
  {
    name: 'Contactado',
    color: '#3b82f6',
    position: 2,
    stage_status: 'open',
    guard_rules: {
      required_evidence: ['message_received'],
      allow_override: true,
      hint: 'No consta ningún mensaje recibido de este contacto.',
    },
  },
  {
    name: 'Interés confirmado',
    color: '#0ea5e9',
    position: 3,
    stage_status: 'open',
    guard_rules: {
      required_evidence: ['call_logged'],
      allow_override: true,
      hint: 'No consta ninguna llamada contestada con este contacto.',
    },
  },
  {
    name: 'Calificado',
    color: '#eab308',
    position: 4,
    stage_status: 'open',
    guard_rules: {
      required_evidence: ['call_logged'],
      allow_override: true,
      hint: 'No consta ninguna llamada contestada con este contacto.',
    },
  },
  {
    name: 'Propuesta aceptada',
    color: '#f97316',
    position: 5,
    stage_status: 'open',
    guard_rules: null,
  },
  {
    name: 'Reserva confirmada',
    color: '#a855f7',
    position: 6,
    stage_status: 'open',
    guard_rules: null,
  },
  {
    name: 'Servicio iniciado',
    color: '#8b5cf6',
    position: 7,
    stage_status: 'open',
    guard_rules: null,
  },
  {
    name: 'Servicio completado',
    color: '#22c55e',
    position: 8,
    stage_status: 'won',
    guard_rules: null,
  },
  // ── Tres ramas terminales, distintas a propósito ──
  // `No contestó` y `Largo plazo` son RECUPERABLES: merecen reactivación.
  // `Desistió` no: quien dijo que no, dijo que no, e insistir quema la lista.
  {
    name: 'No contestó',
    color: '#f43f5e',
    position: 9,
    stage_status: 'lost',
    guard_rules: null,
  },
  {
    name: 'Largo plazo',
    color: '#fb923c',
    position: 10,
    stage_status: 'lost',
    guard_rules: null,
  },
  {
    name: 'Desistió',
    color: '#ef4444',
    position: 11,
    stage_status: 'lost',
    guard_rules: null,
  },
] as const;

/** Las dos ramas terminales que sí admiten reactivación. */
export const RECOVERABLE_LOST_STAGES = ['No contestó', 'Largo plazo'] as const;

/** La rama terminal que NO se reactiva. */
export const FINAL_LOST_STAGE = 'Desistió';

/** Filas listas para insertar en `pipeline_stages`. */
export function defaultStageRows(pipelineId: string) {
  return DEFAULT_STAGES.map((s) => ({
    pipeline_id: pipelineId,
    name: s.name,
    color: s.color,
    position: s.position,
    stage_status: s.stage_status,
    guard_rules: s.guard_rules,
  }));
}

/** Código de PostgREST para "esa columna no existe". */
const UNDEFINED_COLUMN = '42703';

/**
 * Inserta las etapas por defecto de un pipeline recién creado.
 *
 * `stage_status` lo añade la migración 058. Si esa migración todavía no se ha
 * aplicado, el insert entero fallaría con 42703 y **crear un pipeline dejaría
 * de funcionar**. Antes que romper algo que hoy va bien, se reintenta sin esa
 * columna: el pipeline nace con sus doce etapas y sus guardas, y solo pierde
 * el estado terminal automático hasta que la migración corra.
 */
export async function insertDefaultStages(
  supabase: {
    from: (table: string) => {
      insert: (rows: unknown[]) => PromiseLike<{ error: { code?: string } | null }>;
    };
  },
  pipelineId: string
): Promise<void> {
  const rows = defaultStageRows(pipelineId);
  const { error } = await supabase.from('pipeline_stages').insert(rows);
  if (!error) return;

  if (error.code === UNDEFINED_COLUMN) {
    console.warn(
      '[pipelines] `stage_status` no existe todavía — aplica la migración 058. ' +
        'Las etapas se crean sin estado terminal automático.'
    );
    const legacy = rows.map(({ stage_status: _ignored, ...rest }) => rest);
    await supabase.from('pipeline_stages').insert(legacy);
    return;
  }

  console.error('[pipelines] no se pudieron crear las etapas por defecto:', error);
}
