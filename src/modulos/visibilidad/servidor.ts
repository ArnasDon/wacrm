// Solo servidor: depende de arranque.ts (APIs de Node). Sin el paquete
// `server-only` (no está en package.json); misma convención que src/lib/auth/account.ts.
import type { ModuloCargado } from '@contracts/mod/module';
import { obtenerFlujoEntrada } from '@/modulos/arranque';
import { NOMBRE_VISIBILIDAD } from './modulo';

export function estadoVisibilidad(
  cargados: readonly ModuloCargado<unknown>[] = obtenerFlujoEntrada().cargados
): { activo: boolean } {
  const m = cargados.find((c) => c.nombre === NOMBRE_VISIBILIDAD);
  return { activo: m?.activo === true };
}
