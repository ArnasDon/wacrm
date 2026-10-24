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

/** Llama la RPC con el cliente del usuario (navegador o SSR). Nunca lanza. */
export async function reasignarConversacion(
  supabase: Pick<SupabaseClient, 'rpc'>,
  conversacionId: string,
  asesorId: string
): Promise<ResultadoReasignacion> {
  try {
    const { data, error } = await supabase.rpc('mod_asignacion_reasignar', {
      p_conversacion_id: conversacionId,
      p_asesor_id: asesorId,
    });
    if (error) {
      return {
        ok: false,
        motivo: MOTIVO_POR_CODIGO[error.code] ?? 'error',
        mensaje: error.message,
      };
    }
    const r = data as {
      asesorId: string;
      anteriorId: string | null;
      cambio: boolean;
    };
    return {
      ok: true,
      asesorId: r.asesorId,
      anteriorId: r.anteriorId ?? null,
      cambio: r.cambio,
    };
  } catch (e) {
    return {
      ok: false,
      motivo: 'error',
      mensaje: e instanceof Error ? e.message : String(e),
    };
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
