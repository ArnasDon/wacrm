// Solo servidor: depende de arranque.ts (APIs de Node). Sin el paquete
// `server-only` (no está en package.json); misma convención que src/lib/auth/account.ts.
import type { ModuloCargado } from '@contracts/mod/module';
import { obtenerFlujoEntrada } from '@/modulos/arranque';
import { NOMBRE_VISIBILIDAD } from './modulo';

let avisado = false;

/**
 * Nunca lanza: si el arranque de módulos falla (config inválida) no se
 * tumba cada render. Falla cerrado (activo: true = mínimo privilegio) y
 * avisa una sola vez; el error real lo reporta el arranque de módulos.
 */
export function estadoVisibilidad(
  cargados?: readonly ModuloCargado<unknown>[]
): { activo: boolean } {
  if (cargados === undefined) {
    try {
      cargados = obtenerFlujoEntrada().cargados;
    } catch (error) {
      if (!avisado) {
        avisado = true;
        console.error(
          '[visibilidad] el arranque de módulos falló; se aplica visibilidad restringida',
          error
        );
      }
      return { activo: true };
    }
  }
  const m = cargados.find((c) => c.nombre === NOMBRE_VISIBILIDAD);
  return { activo: m?.activo === true };
}
