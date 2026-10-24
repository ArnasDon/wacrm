// Solo servidor: depende de arranque.ts (APIs de Node). Sin el paquete
// `server-only`; misma convención que src/modulos/visibilidad/servidor.ts.
import type { ModuloCargado } from '@contracts/mod/module';
import { obtenerFlujoEntrada } from '@/modulos/arranque';
import { NOMBRE_ASIGNACION } from './modulo';

let avisado = false;

/**
 * Nunca lanza: si el arranque de módulos falla no se tumba cada render.
 * Falla a "apagado" (comportamiento wacrm; el servidor no deja de validar
 * permisos en la RPC) y avisa una sola vez.
 */
export function estadoAsignacion(
  cargados?: readonly ModuloCargado<unknown>[]
): { activo: boolean } {
  if (cargados === undefined) {
    try {
      cargados = obtenerFlujoEntrada().cargados;
    } catch (error) {
      if (!avisado) {
        avisado = true;
        console.error('[asignacion] el arranque de módulos falló', error);
      }
      return { activo: false };
    }
  }
  const m = cargados.find((c) => c.nombre === NOMBRE_ASIGNACION);
  return { activo: m?.activo === true };
}
