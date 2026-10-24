import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { definirModulo } from './module';
import { IDS_STUB, stubEventoEntrada, stubFlujoEntrada } from './module.stub';

describe('stub de I3', () => {
  it('el evento por defecto cumple el contrato: conversación sin asesor', () => {
    const e = stubEventoEntrada();
    expect(e.asesorAsignadoId).toBeNull();
    expect(e.cuentaId).toBe(IDS_STUB.cuenta);
  });

  it('los overrides pasan por el esquema', () => {
    expect(
      stubEventoEntrada({ asesorAsignadoId: IDS_STUB.asesor }).asesorAsignadoId
    ).toBe(IDS_STUB.asesor);
    expect(() => stubEventoEntrada({ conversacionId: 'no-uuid' })).toThrow();
    expect(() => stubEventoEntrada({ recibidoEn: 'ayer' })).toThrow();
    expect(() =>
      stubEventoEntrada({ extra: 1 } as Record<string, unknown>)
    ).toThrow();
  });

  it('sin módulos, el flujo de entrada no hace nada (R16)', async () => {
    const flujo = stubFlujoEntrada([]);
    expect(await flujo.procesar(stubEventoEntrada())).toEqual({
      ejecutados: [],
      errores: [],
    });
  });

  it('llama los enganches en orden de declaración', async () => {
    const orden: string[] = [];
    const mod = (nombre: string) =>
      definirModulo({
        nombre,
        configSchema: z.strictObject({}),
        migraciones: [],
        alEntrarMensaje: async () => {
          orden.push(nombre);
        },
      });
    const flujo = stubFlujoEntrada([mod('b'), mod('a')], {
      a: { activo: true, config: {} },
      b: { activo: true, config: {} },
    });
    expect((await flujo.procesar(stubEventoEntrada())).ejecutados).toEqual([
      'b',
      'a',
    ]);
    expect(orden).toEqual(['b', 'a']);
  });
});
