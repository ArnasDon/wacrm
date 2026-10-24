// CDC de VIS.1 contra el stub de I3: VIS solo necesita su interruptor y su config;
// no se engancha al flujo de entrada (R27: ocultamiento solo de interfaz). El esquema
// de config de aquí es ilustrativo: el real es de VIS.1.
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ErrorConfigModulo, cargarModulo, definirModulo } from './module';
import { stubEventoEntrada, stubFlujoEntrada } from './module.stub';

const ConfigVis = z.strictObject({
  rolesVenTodo: z
    .array(z.enum(['owner', 'admin', 'agent', 'viewer']))
    .default(['owner', 'admin']),
});

const moduloVis = definirModulo({
  nombre: 'visibilidad',
  configSchema: ConfigVis,
  migraciones: [],
});

describe('CDC VIS.1 · interruptor y config sin enganche', () => {
  it('se declara sin migraciones ni enganche', () => {
    expect(moduloVis.migraciones).toEqual([]);
    expect(moduloVis.alEntrarMensaje).toBeUndefined();
  });

  it('apagado o no declarado: inactivo, y la interfaz se comporta como wacrm (R16)', () => {
    expect(cargarModulo(moduloVis, undefined).activo).toBe(false);
    expect(cargarModulo(moduloVis, { activo: false, config: {} }).activo).toBe(
      false
    );
  });

  it('encendido: lee su config con los valores por defecto', () => {
    const m = cargarModulo(moduloVis, { activo: true, config: {} });
    expect(m).toEqual({
      nombre: 'visibilidad',
      activo: true,
      config: { rolesVenTodo: ['owner', 'admin'] },
      alEntrarMensaje: undefined,
    });
  });

  it('una config inválida falla al arrancar (R18)', () => {
    expect(() =>
      cargarModulo(moduloVis, {
        activo: true,
        config: { rolesVenTodo: ['nadie'] },
      })
    ).toThrow(ErrorConfigModulo);
  });

  it('convive con ASG: el flujo de entrada solo llama los enganches que existen (R20)', async () => {
    const asg = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const flujo = stubFlujoEntrada(
      [
        moduloVis,
        definirModulo({
          nombre: 'asignacion',
          configSchema: z.strictObject({}),
          migraciones: [],
          alEntrarMensaje: asg,
        }),
      ],
      {
        visibilidad: { activo: true, config: {} },
        asignacion: { activo: true, config: {} },
      }
    );
    const r = await flujo.procesar(stubEventoEntrada());
    expect(r).toEqual({ ejecutados: ['asignacion'], errores: [] });
    expect(asg).toHaveBeenCalledOnce();
  });
});
