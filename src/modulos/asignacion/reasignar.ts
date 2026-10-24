import type { SupabaseClient } from '@supabase/supabase-js';

export type MotivoFalloReasignacion =
  'sin-permiso' | 'no-encontrada' | 'asesor-invalido' | 'error';

export type ResultadoReasignacion =
  | { ok: true; asesorId: string; anteriorId: string | null; cambio: boolean }
  | { ok: false; motivo: MotivoFalloReasignacion; mensaje: string };

const MOTIVO_POR_CODIGO: Record<string, MotivoFalloReasignacion> = {
  '42501': 'sin-permiso',
  P0002: 'no-encontrada',
  '22023': 'asesor-invalido',
};

/** Tope de espera de la RPC desde el navegador. */
export const TIMEOUT_REASIGNAR_MS = 10000;

/** Llama la RPC con el cliente del usuario (navegador o SSR). Nunca lanza. */
export async function reasignarConversacion(
  supabase: Pick<SupabaseClient, 'rpc'>,
  conversacionId: string,
  asesorId: string
): Promise<ResultadoReasignacion> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { data, error } = await Promise.race([
      supabase.rpc('mod_asignacion_reasignar', {
        p_conversacion_id: conversacionId,
        p_asesor_id: asesorId,
      }),
      new Promise<never>((_, rechazar) => {
        timer = setTimeout(
          () => rechazar(new Error('tiempo de espera agotado')),
          TIMEOUT_REASIGNAR_MS
        );
      }),
    ]);
    if (error) {
      return {
        ok: false,
        motivo: MOTIVO_POR_CODIGO[error.code] ?? 'error',
        mensaje: error.message,
      };
    }
    const r = data as {
      asesorId?: unknown;
      anteriorId?: unknown;
      cambio?: unknown;
    } | null;
    if (
      !r ||
      typeof r.asesorId !== 'string' ||
      typeof r.cambio !== 'boolean' ||
      (r.anteriorId != null && typeof r.anteriorId !== 'string')
    ) {
      return {
        ok: false,
        motivo: 'error',
        mensaje: 'respuesta inválida de mod_asignacion_reasignar',
      };
    }
    return {
      ok: true,
      asesorId: r.asesorId,
      anteriorId: (r.anteriorId as string | null | undefined) ?? null,
      cambio: r.cambio,
    };
  } catch (e) {
    return {
      ok: false,
      motivo: 'error',
      mensaje: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

export type ModoSelectorAsesor = 'wacrm' | 'reasignar' | 'solo-lectura';

/**
 * Apagado → 'wacrm'; encendido y admin/owner → 'reasignar'; encendido y otro
 * rol o rol sin resolver → 'solo-lectura' (falla cerrado).
 */
export function modoSelectorAsesor(e: {
  moduloActivo: boolean;
  puedeGestionar: boolean | null;
}): ModoSelectorAsesor {
  if (!e.moduloActivo) return 'wacrm';
  return e.puedeGestionar === true ? 'reasignar' : 'solo-lectura';
}
