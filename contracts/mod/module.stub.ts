/**
 * Stub del contrato I3: un evento de entrada que pasa por EventoEntradaSchema.parse y
 * un flujo de entrada falso con la semántica que MOD.1 debe cumplir. Los consumidores
 * (ASG, VIS) prueban contra esto, no contra el webhook real.
 */

import type { ModuloSwitch } from '../cfg/tenant-config';
import {
  EventoEntradaSchema,
  cargarModulo,
  type DefinicionModulo,
  type EventoEntrada,
  type ModuloCargado,
} from './module';

export const IDS_STUB = {
  cuenta: '11111111-1111-4111-8111-111111111111',
  conversacion: '22222222-2222-4222-8222-222222222222',
  contacto: '33333333-3333-4333-8333-333333333333',
  mensaje: '44444444-4444-4444-8444-444444444444',
  asesor: '55555555-5555-4555-8555-555555555555',
} as const;

export function stubEventoEntrada(
  overrides: Partial<Record<keyof EventoEntrada, unknown>> = {}
): EventoEntrada {
  return EventoEntradaSchema.parse({
    cuentaId: IDS_STUB.cuenta,
    conversacionId: IDS_STUB.conversacion,
    contactoId: IDS_STUB.contacto,
    mensajeId: IDS_STUB.mensaje,
    asesorAsignadoId: null,
    conversacionNueva: false,
    recibidoEn: '2026-10-24T15:00:00.000Z',
    ...overrides,
  });
}

export interface ResultadoEntrada {
  ejecutados: string[];
  errores: { modulo: string; error: unknown }[];
}

export interface FlujoEntradaStub {
  cargados: readonly ModuloCargado<unknown>[];
  procesar(evento: EventoEntrada): Promise<ResultadoEntrada>;
}

/**
 * Arranque: carga todos los módulos (una config inválida lanza aquí, R18).
 * Por mensaje: llama en orden de declaración el enganche de cada módulo encendido;
 * el error de un módulo se registra y no corta a los demás ni al flujo de entrada.
 */
export function stubFlujoEntrada(
  modulos: readonly DefinicionModulo<unknown>[],
  interruptores: Record<string, ModuloSwitch> = {}
): FlujoEntradaStub {
  const cargados = modulos.map((def) =>
    cargarModulo(def, interruptores[def.nombre])
  );
  return {
    cargados,
    async procesar(evento) {
      const valido = EventoEntradaSchema.parse(evento);
      const resultado: ResultadoEntrada = { ejecutados: [], errores: [] };
      for (const m of cargados) {
        if (!m.activo || !m.alEntrarMensaje) continue;
        try {
          await m.alEntrarMensaje(valido, m.config);
          resultado.ejecutados.push(m.nombre);
        } catch (error) {
          resultado.errores.push({ modulo: m.nombre, error });
        }
      }
      return resultado;
    },
  };
}
