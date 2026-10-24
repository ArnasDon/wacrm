import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ErrorConfigModulo,
  ErrorDefinicionModulo,
  MIGRACION_WACRM,
  VERSION_CONTRATO,
  cargarModulo,
  definirModulo,
  esMigracionDeModulo,
  ordenMigraciones,
  prefijoMigracion,
} from './module';

describe('migraciones con prefijo propio (R17)', () => {
  it('el prefijo es mod_<nombre>_', () => {
    expect(prefijoMigracion('asignacion')).toBe('mod_asignacion_');
  });

  it.each(['mod_asignacion_001.sql', 'mod_asignacion_012_reglas.sql'])(
    'reconoce %s como de asignacion',
    (archivo) => {
      expect(esMigracionDeModulo(archivo, 'asignacion')).toBe(true);
    }
  );

  it.each([
    'mod_asignacion_1.sql',
    'mod_asignacion_001.SQL',
    'mod_visibilidad_001.sql',
    'mod_asignacionx_001.sql',
    '060_asignacion.sql',
    'asignacion_001.sql',
  ])('no reconoce %s como de asignacion', (archivo) => {
    expect(esMigracionDeModulo(archivo, 'asignacion')).toBe(false);
  });

  it('las migraciones de wacrm no parecen de módulo y viceversa', () => {
    expect(MIGRACION_WACRM.test('059_dashboard_overview.sql')).toBe(true);
    expect(MIGRACION_WACRM.test('mod_asignacion_001.sql')).toBe(false);
  });

  it('las de módulos corren después de todas las de wacrm, incluso futuras', () => {
    const orden = ordenMigraciones([
      'mod_visibilidad_001.sql',
      '999_futura.sql',
      'mod_asignacion_002_x.sql',
      '001_initial_schema.sql',
      'mod_asignacion_001.sql',
    ]);
    expect(orden).toEqual([
      '001_initial_schema.sql',
      '999_futura.sql',
      'mod_asignacion_001.sql',
      'mod_asignacion_002_x.sql',
      'mod_visibilidad_001.sql',
    ]);
  });
});

describe('definirModulo', () => {
  const base = { configSchema: z.strictObject({}), migraciones: [] };

  it('acepta un nombre en minúsculas sin guiones', () => {
    expect(definirModulo({ ...base, nombre: 'asignacion' }).nombre).toBe(
      'asignacion'
    );
  });

  it.each(['Asignacion', 'asig-nacion', 'asig_nacion', '1asig', ''])(
    'rechaza el nombre %j',
    (nombre) => {
      expect(() => definirModulo({ ...base, nombre })).toThrow(
        ErrorDefinicionModulo
      );
    }
  );

  it('rechaza una migración sin el prefijo del módulo', () => {
    expect(() =>
      definirModulo({
        ...base,
        nombre: 'asignacion',
        migraciones: ['mod_visibilidad_001.sql'],
      })
    ).toThrow(/mod_asignacion_NNN/);
  });

  it('rechaza migraciones repetidas', () => {
    expect(() =>
      definirModulo({
        ...base,
        nombre: 'asignacion',
        migraciones: ['mod_asignacion_001.sql', 'mod_asignacion_001.sql'],
      })
    ).toThrow(ErrorDefinicionModulo);
  });
});

describe('cargarModulo (interruptor + config zod)', () => {
  const def = definirModulo({
    nombre: 'demo',
    configSchema: z.strictObject({ limite: z.number().int().positive() }),
    migraciones: [],
  });

  it('no declarado o apagado: inactivo y sin validar la config (R16)', () => {
    expect(cargarModulo(def, undefined)).toEqual({
      nombre: 'demo',
      activo: false,
    });
    expect(
      cargarModulo(def, { activo: false, config: { limite: 'basura' } })
    ).toEqual({ nombre: 'demo', activo: false });
  });

  it('encendido con config válida: devuelve la config parseada', () => {
    const m = cargarModulo(def, { activo: true, config: { limite: 3 } });
    expect(m).toMatchObject({ activo: true, config: { limite: 3 } });
  });

  it('encendido con config inválida: ErrorConfigModulo con el módulo (R18)', () => {
    const fallo = () =>
      cargarModulo(def, { activo: true, config: { limite: 0, extra: 1 } });
    expect(fallo).toThrow(ErrorConfigModulo);
    expect(fallo).toThrow(/demo/);
  });

  it('expone la versión del contrato', () => {
    expect(VERSION_CONTRATO).toBe('I3.v1');
  });
});
