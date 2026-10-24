import { describe, expect, it } from 'vitest';
import {
  ErrorConfigModulo,
  cargarModulo,
} from '@contracts/mod/module';
import {
  stubEventoEntrada,
  stubFlujoEntrada,
} from '@contracts/mod/module.stub';
import { MODULOS } from '../registro';
import { moduloVisibilidad } from './modulo';
import { estadoVisibilidad } from './servidor';

describe('CDC VIS.1 · módulo real contra el stub de CT.3', () => {
  it('se declara como visibilidad, sin migraciones ni enganche', () => {
    expect(moduloVisibilidad.nombre).toBe('visibilidad');
    expect(moduloVisibilidad.migraciones).toEqual([]);
    expect(moduloVisibilidad.alEntrarMensaje).toBeUndefined();
  });
  it('no declarado o apagado: inactivo (R16)', () => {
    expect(cargarModulo(moduloVisibilidad, undefined).activo).toBe(false);
    expect(
      cargarModulo(moduloVisibilidad, { activo: false, config: { basura: 1 } })
        .activo
    ).toBe(false);
  });
  it('encendido con config vacía arranca', () => {
    expect(
      cargarModulo(moduloVisibilidad, { activo: true, config: {} })
    ).toMatchObject({ nombre: 'visibilidad', activo: true, config: {} });
  });
  it('encendido con llaves de más falla al arrancar (R18)', () => {
    expect(() =>
      cargarModulo(moduloVisibilidad, {
        activo: true,
        config: { rolesVenTodo: ['agent'] },
      })
    ).toThrow(ErrorConfigModulo);
  });
  it('el flujo de entrada no lo ejecuta (R27)', async () => {
    const flujo = stubFlujoEntrada([moduloVisibilidad], {
      visibilidad: { activo: true, config: {} },
    });
    expect(await flujo.procesar(stubEventoEntrada())).toEqual({
      ejecutados: [],
      errores: [],
    });
  });
});

describe('estadoVisibilidad', () => {
  it('activo solo si el módulo cargado está encendido', () => {
    expect(estadoVisibilidad([])).toEqual({ activo: false });
    expect(
      estadoVisibilidad([
        cargarModulo(moduloVisibilidad, { activo: false, config: {} }),
      ])
    ).toEqual({ activo: false });
    expect(
      estadoVisibilidad([
        cargarModulo(moduloVisibilidad, { activo: true, config: {} }),
      ])
    ).toEqual({ activo: true });
  });
});

it('el registro de MOD.1 incluye visibilidad', () => {
  expect(MODULOS.map((m) => m.nombre)).toContain('visibilidad');
});
