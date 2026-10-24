import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  definirModulo,
  ErrorConfigModulo,
  type EventoEntrada,
} from '@contracts/mod/module';
import { stubEventoEntrada } from '@contracts/mod/module.stub';
import { crearFlujoEntrada, ErrorModuloDesconocido } from './flujo-entrada';

type Cfg = { limite: number };
const modulo = (
  nombre = 'demo',
  enganche?: (e: EventoEntrada, c: Cfg) => Promise<void>
) =>
  definirModulo<Cfg>({
    nombre,
    configSchema: z.strictObject({ limite: z.number().int().positive() }),
    migraciones: [],
    alEntrarMensaje: enganche,
  }) as never;
const on = (config: unknown = { limite: 1 }) =>
  ({ activo: true, config }) as never;

describe('crearFlujoEntrada', () => {
  it('sin módulos: nada que enganchar y procesar no hace nada (R16)', async () => {
    const f = crearFlujoEntrada([], {});
    expect(f.hayEnganches).toBe(false);
    expect(await f.procesar(stubEventoEntrada())).toEqual({
      ejecutados: [],
      errores: [],
    });
  });
  it('apagado con config basura: no valida, no engancha (R16)', async () => {
    const espia = vi.fn(async () => {});
    const f = crearFlujoEntrada([modulo('demo', espia)], {
      demo: { activo: false, config: { limite: 'x' } },
    });
    expect(f.hayEnganches).toBe(false);
    await f.procesar(stubEventoEntrada());
    expect(espia).not.toHaveBeenCalled();
  });
  it('encendido con config inválida: ErrorConfigModulo (R18)', () => {
    expect(() =>
      crearFlujoEntrada([modulo()], { demo: on({ limite: 0 }) })
    ).toThrow(ErrorConfigModulo);
  });
  it('encendido y no registrado: ErrorModuloDesconocido', () => {
    expect(() =>
      crearFlujoEntrada([], { asignacoin: { activo: true, config: {} } })
    ).toThrow(ErrorModuloDesconocido);
  });
  it('apagado y no registrado: se ignora', () => {
    expect(() =>
      crearFlujoEntrada([], { asignacion: { activo: false, config: {} } })
    ).not.toThrow();
  });
  it('llama al enganche con el evento y la config parseada', async () => {
    const espia = vi.fn(async () => {});
    const f = crearFlujoEntrada([modulo('demo', espia)], {
      demo: on({ limite: 3 }),
    });
    expect(f.hayEnganches).toBe(true);
    const e = stubEventoEntrada();
    expect(await f.procesar(e)).toEqual({ ejecutados: ['demo'], errores: [] });
    expect(espia).toHaveBeenCalledWith(e, { limite: 3 });
  });
  it('un enganche que lanza no corta a los demás', async () => {
    const error = new Error('boom');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = crearFlujoEntrada(
      [
        modulo('malo', async () => {
          throw error;
        }),
        modulo('bueno', async () => {}),
      ],
      { malo: on(), bueno: on() }
    );
    expect(await f.procesar(stubEventoEntrada())).toEqual({
      ejecutados: ['bueno'],
      errores: [{ modulo: 'malo', error }],
    });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
  it('llama en orden de declaración', async () => {
    const f = crearFlujoEntrada(
      [modulo('b', async () => {}), modulo('a', async () => {})],
      { a: on(), b: on() }
    );
    expect((await f.procesar(stubEventoEntrada())).ejecutados).toEqual([
      'b',
      'a',
    ]);
  });
});
