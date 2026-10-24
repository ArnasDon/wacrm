import type { ModuloSwitch } from '@contracts/cfg/tenant-config';
import {
  cargarModulo,
  EventoEntradaSchema,
  type DefinicionModulo,
  type EventoEntrada,
  type ModuloCargado,
} from '@contracts/mod/module';

export class ErrorModuloDesconocido extends Error {
  override name = 'ErrorModuloDesconocido';
  constructor(readonly modulo: string) {
    super(`el módulo ${modulo} está encendido pero no está registrado`);
  }
}

export interface ResultadoEntrada {
  ejecutados: string[];
  errores: { modulo: string; error: unknown }[];
}

export interface FlujoEntrada {
  cargados: readonly ModuloCargado<unknown>[];
  /** true si algún módulo encendido tiene alEntrarMensaje. */
  hayEnganches: boolean;
  procesar(evento: EventoEntrada): Promise<ResultadoEntrada>;
}

/**
 * Misma semántica que stubFlujoEntrada de CT.3, más: un módulo encendido que
 * nadie registró falla (error de tipeo); apagado y no registrado se ignora.
 */
export function crearFlujoEntrada(
  modulos: readonly DefinicionModulo<unknown>[],
  interruptores: Record<string, ModuloSwitch>
): FlujoEntrada {
  const registrados = new Set(modulos.map((m) => m.nombre));
  for (const [nombre, sw] of Object.entries(interruptores)) {
    if (sw.activo && !registrados.has(nombre)) {
      throw new ErrorModuloDesconocido(nombre);
    }
  }
  const cargados = modulos.map((def) =>
    cargarModulo(def, interruptores[def.nombre])
  );
  const hayEnganches = cargados.some((m) => m.activo && m.alEntrarMensaje);
  return {
    cargados,
    hayEnganches,
    async procesar(evento) {
      const valido = EventoEntradaSchema.parse(evento);
      const resultado: ResultadoEntrada = { ejecutados: [], errores: [] };
      for (const m of cargados) {
        if (!m.activo || !m.alEntrarMensaje) continue;
        try {
          await m.alEntrarMensaje(valido, m.config);
          resultado.ejecutados.push(m.nombre);
        } catch (error) {
          console.error('[modulos]', m.nombre, error);
          resultado.errores.push({ modulo: m.nombre, error });
        }
      }
      return resultado;
    },
  };
}
