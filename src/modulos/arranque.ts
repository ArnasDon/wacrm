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

// Next compila instrumentation y cada ruta como bundles aparte: una variable de
// módulo no se compartiría entre ellos. La caché vive en globalThis para que el
// arranque y el webhook vean el mismo flujo (y, si no, la ruta lo crea perezosa).
const CLAVE = Symbol.for('wacrm.modulos.flujoEntrada');
type ConCache = { [CLAVE]?: FlujoEntrada };
const global_ = globalThis as unknown as ConCache;

/** Arranca una sola vez y cachea (compartido entre bundles). */
export function obtenerFlujoEntrada(): FlujoEntrada {
  global_[CLAVE] ??= arrancarModulos();
  return global_[CLAVE];
}

/** Solo pruebas: reemplaza o limpia la caché. */
export function fijarFlujoEntrada(f: FlujoEntrada | undefined): void {
  global_[CLAVE] = f;
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
