import {
  definirModulo,
  ErrorDefinicionModulo,
  type DefinicionModulo,
} from '@contracts/mod/module';
import { moduloAsignacion } from './asignacion/modulo';
import { moduloVisibilidad } from './visibilidad/modulo';

/** Pasa cada módulo por definirModulo y rechaza nombres repetidos. */
export function registrarModulos(
  defs: readonly DefinicionModulo<unknown>[]
): readonly DefinicionModulo<unknown>[] {
  const vistos = new Set<string>();
  const lista = defs.map((d) => {
    const def = definirModulo(d);
    if (vistos.has(def.nombre)) {
      throw new ErrorDefinicionModulo(`módulo repetido: ${def.nombre}`);
    }
    vistos.add(def.nombre);
    return def;
  });
  return Object.freeze(lista);
}

export const MODULOS: readonly DefinicionModulo<unknown>[] = registrarModulos([
  moduloAsignacion as DefinicionModulo<unknown>,
  moduloVisibilidad as DefinicionModulo<unknown>,
]);
