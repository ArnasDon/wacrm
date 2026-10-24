import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS_STUB, stubEventoEntrada } from '@contracts/mod/module.stub';
import { ConfigAsignacionSchema } from './config';

const rpc = vi.fn();
const abortSignal = vi.fn();
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc }),
}));

import {
  asignarConSupabase,
  crearModuloAsignacion,
  type AsignarFn,
} from './modulo';

const cfg = ConfigAsignacionSchema.parse({});

describe('moduloAsignacion · enganche', () => {
  it('se declara como asignacion con su migración', () => {
    const m = crearModuloAsignacion(vi.fn());
    expect(m.nombre).toBe('asignacion');
    expect(m.migraciones).toEqual(['mod_asignacion_001_motor.sql']);
  });
  it('sin asesor: llama asignar con conversación, mensaje y reglas en orden', async () => {
    const asignar = vi.fn<AsignarFn>().mockResolvedValue(null);
    await crearModuloAsignacion(asignar).alEntrarMensaje!(
      stubEventoEntrada(),
      cfg
    );
    expect(asignar).toHaveBeenCalledWith({
      conversacionId: IDS_STUB.conversacion,
      mensajeId: IDS_STUB.mensaje,
      reglas: ['asesor-previo', 'reparto-equitativo'],
    });
  });
  it('con asesor: no llama asignar', async () => {
    const asignar = vi.fn<AsignarFn>();
    await crearModuloAsignacion(asignar).alEntrarMensaje!(
      stubEventoEntrada({ asesorAsignadoId: IDS_STUB.asesor }),
      cfg
    );
    expect(asignar).not.toHaveBeenCalled();
  });
  it('si asignar falla, el enganche lanza', async () => {
    const asignar = vi
      .fn<AsignarFn>()
      .mockRejectedValue(new Error('rpc caída'));
    await expect(
      crearModuloAsignacion(asignar).alEntrarMensaje!(stubEventoEntrada(), cfg)
    ).rejects.toThrow('rpc caída');
  });
});

describe('asignarConSupabase', () => {
  const args = {
    conversacionId: IDS_STUB.conversacion,
    mensajeId: IDS_STUB.mensaje,
    reglas: ['asesor-previo' as const],
  };
  beforeEach(() => {
    rpc.mockReset();
    abortSignal.mockReset();
    rpc.mockReturnValue({ abortSignal });
  });

  it('llama la RPC con parámetros y un tope de tiempo', async () => {
    abortSignal.mockResolvedValue({ data: null, error: null });
    expect(await asignarConSupabase(args)).toBeNull();
    expect(rpc).toHaveBeenCalledWith('mod_asignacion_asignar', {
      p_conversacion_id: IDS_STUB.conversacion,
      p_mensaje_id: IDS_STUB.mensaje,
      p_reglas: ['asesor-previo'],
    });
    expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });
  it('devuelve el resultado', async () => {
    const r = { asesorId: IDS_STUB.asesor, regla: 'asesor-previo' };
    abortSignal.mockResolvedValue({ data: r, error: null });
    expect(await asignarConSupabase(args)).toEqual(r);
  });
  it('un error lanza', async () => {
    abortSignal.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(asignarConSupabase(args)).rejects.toThrow('x');
  });
});
