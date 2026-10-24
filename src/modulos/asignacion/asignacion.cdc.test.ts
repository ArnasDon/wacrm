import { describe, expect, it, vi } from 'vitest';
import { ErrorConfigModulo } from '@contracts/mod/module';
import {
  stubEventoEntrada,
  stubFlujoEntrada,
} from '@contracts/mod/module.stub';
import {
  crearModuloAsignacion,
  moduloAsignacion,
  type AsignarFn,
} from './modulo';

const encendido = { asignacion: { activo: true, config: {} } };

describe('CDC ASG.1 (módulo real) contra el stub de I3', () => {
  it('encendido: un mensaje sin asesor ejecuta la asignación con los defaults', async () => {
    const asignar = vi.fn<AsignarFn>().mockResolvedValue(null);
    const r = await stubFlujoEntrada(
      [crearModuloAsignacion(asignar) as never],
      encendido
    ).procesar(stubEventoEntrada());
    expect(r).toEqual({ ejecutados: ['asignacion'], errores: [] });
    expect(asignar.mock.calls[0]![0].reglas).toEqual([
      'asesor-previo',
      'reparto-equitativo',
    ]);
  });
  it('apagado: no se llama (R16)', async () => {
    const asignar = vi.fn<AsignarFn>();
    await stubFlujoEntrada([crearModuloAsignacion(asignar) as never], {
      asignacion: { activo: false, config: { reglas: ['por-ia'] } },
    }).procesar(stubEventoEntrada());
    expect(asignar).not.toHaveBeenCalled();
  });
  it('config inválida falla al arrancar (R18)', () => {
    expect(() =>
      stubFlujoEntrada([moduloAsignacion as never], {
        asignacion: {
          activo: true,
          config: { reglas: ['reparto-equitativo', 'asesor-previo'] },
        },
      })
    ).toThrow(ErrorConfigModulo);
  });
  it('un error de la RPC queda en errores y no corta el flujo', async () => {
    const asignar = vi.fn<AsignarFn>().mockRejectedValue(new Error('x'));
    const r = await stubFlujoEntrada(
      [crearModuloAsignacion(asignar) as never],
      encendido
    ).procesar(stubEventoEntrada());
    expect(r.errores.map((e) => e.modulo)).toEqual(['asignacion']);
  });
});
