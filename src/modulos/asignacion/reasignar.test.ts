import { describe, expect, it, vi } from 'vitest';
import { modoSelectorAsesor, reasignarConversacion } from './reasignar';

const C = '00000000-0000-4000-8000-0000000000c1';
const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000a2';

describe('reasignarConversacion', () => {
  it('llama la RPC con los parámetros de la función', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { asesorId: A, anteriorId: null, regla: 'manual', cambio: true },
      error: null,
    });
    await reasignarConversacion({ rpc } as never, C, A);
    expect(rpc).toHaveBeenCalledWith('mod_asignacion_reasignar', {
      p_conversacion_id: C,
      p_asesor_id: A,
    });
  });
  it('traduce la respuesta', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { asesorId: A, anteriorId: B, regla: 'manual', cambio: true },
      error: null,
    });
    expect(await reasignarConversacion({ rpc } as never, C, A)).toEqual({
      ok: true,
      asesorId: A,
      anteriorId: B,
      cambio: true,
    });
  });
  it('traduce los errores por código', async () => {
    const con = (code: string) =>
      reasignarConversacion(
        {
          rpc: vi
            .fn()
            .mockResolvedValue({ data: null, error: { code, message: 'x' } }),
        } as never,
        C,
        A
      );
    expect(await con('42501')).toMatchObject({
      ok: false,
      motivo: 'sin-permiso',
    });
    expect(await con('P0002')).toMatchObject({ motivo: 'no-encontrada' });
    expect(await con('22023')).toMatchObject({ motivo: 'asesor-invalido' });
    expect(await con('XX000')).toMatchObject({ motivo: 'error' });
    const red = vi.fn().mockRejectedValue(new Error('red'));
    expect(await reasignarConversacion({ rpc: red } as never, C, A)).toEqual({
      ok: false,
      motivo: 'error',
      mensaje: 'red',
    });
  });
});

describe('modoSelectorAsesor', () => {
  it('apagado es wacrm para cualquier rol', () => {
    for (const p of [true, false, null])
      expect(
        modoSelectorAsesor({ moduloActivo: false, puedeGestionar: p })
      ).toBe('wacrm');
  });
  it('encendido: admin/owner reasigna', () => {
    expect(
      modoSelectorAsesor({ moduloActivo: true, puedeGestionar: true })
    ).toBe('reasignar');
  });
  it('encendido: asesor o rol sin resolver solo lee', () => {
    expect(
      modoSelectorAsesor({ moduloActivo: true, puedeGestionar: false })
    ).toBe('solo-lectura');
    expect(
      modoSelectorAsesor({ moduloActivo: true, puedeGestionar: null })
    ).toBe('solo-lectura');
  });
});
