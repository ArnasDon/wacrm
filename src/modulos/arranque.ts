import type { ModuloSwitch } from '@contracts/cfg/tenant-config';
import {
  EventoEntradaSchema,
  type DefinicionModulo,
  type EventoEntrada,
} from '@contracts/mod/module';
import { crearFlujoEntrada, type FlujoEntrada } from './flujo-entrada';
import { leerInterruptores } from './interruptores';
import { MODULOS } from './registro';

/** Lanza ErrorInterruptores | ErrorModuloDesconocido | ErrorConfigModulo. */
export function arrancarModulos(
  opciones: {
    modulos?: readonly DefinicionModulo<unknown>[];
    interruptores?: Record<string, ModuloSwitch>;
  } = {}
): FlujoEntrada {
  return crearFlujoEntrada(
    opciones.modulos ?? MODULOS,
    opciones.interruptores ?? leerInterruptores()
  );
}

let flujo: FlujoEntrada | undefined;

/** Arranca una sola vez y cachea. */
export function obtenerFlujoEntrada(): FlujoEntrada {
  flujo ??= arrancarModulos();
  return flujo;
}

/** Solo pruebas: reemplaza o limpia la caché. */
export function fijarFlujoEntrada(f: FlujoEntrada | undefined): void {
  flujo = f;
}

/** Nunca lanza. Con hayEnganches === false vuelve sin parsear el evento. */
export async function despacharEntradaAModulos(
  datos: EventoEntrada
): Promise<void> {
  try {
    let f: FlujoEntrada;
    try {
      f = obtenerFlujoEntrada();
    } catch (error) {
      console.error('[modulos] el arranque de módulos falló', error);
      return;
    }
    if (!f.hayEnganches) return;
    const evento = EventoEntradaSchema.safeParse(datos);
    if (!evento.success) {
      console.error(
        '[modulos] evento de entrada inválido',
        evento.error.issues
      );
      return;
    }
    await f.procesar(evento.data);
  } catch (error) {
    console.error('[modulos] error al despachar la entrada', error);
  }
}
