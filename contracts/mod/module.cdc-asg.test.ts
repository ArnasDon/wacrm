// CDC de ASG.1 contra el stub de I3: lo que el motor de asignación necesita del
// mecanismo de módulos. El esquema de config de aquí es ilustrativo: el real es de ASG.1.
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ErrorConfigModulo, definirModulo, type EventoEntrada } from './module';
import type { ModuloSwitch } from '../cfg/tenant-config';
import { IDS_STUB, stubEventoEntrada, stubFlujoEntrada } from './module.stub';

const ConfigAsg = z.strictObject({
  reglas: z
    .array(z.enum(['asesor-previo', 'reparto-equitativo']))
    .min(1)
    .default(['asesor-previo', 'reparto-equitativo']),
});

function moduloAsg(enganche: Enganche) {
  return definirModulo({
    nombre: 'asignacion',
    configSchema: ConfigAsg,
    migraciones: ['mod_asignacion_001_asignaciones.sql'],
    alEntrarMensaje: enganche,
  });
}

type ConfigAsgT = z.infer<typeof ConfigAsg>;
type Enganche = (e: EventoEntrada, c: ConfigAsgT) => Promise<void>;
const espia = () => vi.fn<Enganche>().mockResolvedValue(undefined);

const encendido = { asignacion: { activo: true, config: {} } };

describe('CDC ASG.1 · enganche en el flujo de entrada', () => {
  it('declara sus migraciones con el prefijo mod_asignacion_', () => {
    expect(moduloAsg(async () => {}).migraciones).toEqual([
      'mod_asignacion_001_asignaciones.sql',
    ]);
  });

  it('recibe cada mensaje de una conversación sin asesor con asesorAsignadoId null (R21)', async () => {
    const enganche = espia();
    const flujo = stubFlujoEntrada([moduloAsg(enganche)], encendido);
    await flujo.procesar(stubEventoEntrada());
    await flujo.procesar(stubEventoEntrada({ conversacionNueva: true }));
    expect(enganche).toHaveBeenCalledTimes(2);
    expect(enganche.mock.calls[0][0]).toMatchObject({
      conversacionId: IDS_STUB.conversacion,
      contactoId: IDS_STUB.contacto,
      asesorAsignadoId: null,
    });
  });

  it('ve el asesor ya asignado para no sobrescribirlo', async () => {
    const enganche = espia();
    const flujo = stubFlujoEntrada([moduloAsg(enganche)], encendido);
    await flujo.procesar(
      stubEventoEntrada({ asesorAsignadoId: IDS_STUB.asesor })
    );
    expect(enganche.mock.calls[0][0].asesorAsignadoId).toBe(IDS_STUB.asesor);
  });

  it('recibe su config ya validada, con los valores por defecto aplicados', async () => {
    const enganche = espia();
    await stubFlujoEntrada([moduloAsg(enganche)], encendido).procesar(
      stubEventoEntrada()
    );
    expect(enganche.mock.calls[0][1]).toEqual({
      reglas: ['asesor-previo', 'reparto-equitativo'],
    });
  });

  it('apagado o no declarado, nunca se llama (R16)', async () => {
    const enganche = espia();
    const casos: Record<string, ModuloSwitch>[] = [
      {},
      { asignacion: { activo: false, config: {} } },
    ];
    for (const interruptores of casos) {
      const r = await stubFlujoEntrada(
        [moduloAsg(enganche)],
        interruptores
      ).procesar(stubEventoEntrada());
      expect(r.ejecutados).toEqual([]);
    }
    expect(enganche).not.toHaveBeenCalled();
  });

  it('una config inválida falla al arrancar, no al primer mensaje (R18)', () => {
    expect(() =>
      stubFlujoEntrada([moduloAsg(async () => {})], {
        asignacion: { activo: true, config: { reglas: ['por-ia'] } },
      })
    ).toThrow(ErrorConfigModulo);
  });

  it('si el enganche falla, el error queda registrado y el flujo sigue', async () => {
    const r = await stubFlujoEntrada(
      [
        moduloAsg(async () => {
          throw new Error('sin asesores');
        }),
      ],
      encendido
    ).procesar(stubEventoEntrada());
    expect(r.ejecutados).toEqual([]);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0].modulo).toBe('asignacion');
  });
});
