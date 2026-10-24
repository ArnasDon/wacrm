import { definirModulo, type DefinicionModulo } from '@contracts/mod/module';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  ConfigAsignacionSchema,
  type ConfigAsignacion,
  type ReglaAsignacion,
} from './config';

export const NOMBRE_ASIGNACION = 'asignacion';

/** Tope de espera de la RPC: el flujo de entrada no puede colgarse (MOD.1). */
export const TIMEOUT_ASIGNACION_MS = 5000;

export type ResultadoAsignacion = {
  asesorId: string;
  regla: ReglaAsignacion;
} | null;

export type AsignarFn = (args: {
  conversacionId: string;
  mensajeId: string;
  reglas: ReglaAsignacion[];
}) => Promise<ResultadoAsignacion>;

export const asignarConSupabase: AsignarFn = async ({
  conversacionId,
  mensajeId,
  reglas,
}) => {
  const { data, error } = await supabaseAdmin()
    .rpc('mod_asignacion_asignar', {
      p_conversacion_id: conversacionId,
      p_mensaje_id: mensajeId,
      p_reglas: reglas,
    })
    .abortSignal(AbortSignal.timeout(TIMEOUT_ASIGNACION_MS));
  if (error) throw new Error(error.message);
  return (data as ResultadoAsignacion) ?? null;
};

export function crearModuloAsignacion(
  asignar: AsignarFn = asignarConSupabase
): DefinicionModulo<ConfigAsignacion> {
  return definirModulo<ConfigAsignacion>({
    nombre: NOMBRE_ASIGNACION,
    configSchema: ConfigAsignacionSchema,
    migraciones: [
      'mod_asignacion_001_motor.sql',
      'mod_asignacion_002_reglas.sql',
      'mod_asignacion_003_reasignacion.sql',
    ],
    async alEntrarMensaje(evento, config) {
      if (evento.asesorAsignadoId !== null) return;
      await asignar({
        conversacionId: evento.conversacionId,
        mensajeId: evento.mensajeId,
        reglas: config.reglas,
      });
    },
  });
}

export const moduloAsignacion = crearModuloAsignacion();
