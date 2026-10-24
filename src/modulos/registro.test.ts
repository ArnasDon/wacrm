import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErrorDefinicionModulo } from '@contracts/mod/module';
import { MODULOS, registrarModulos } from './registro';

const def = (nombre: string) => ({
  nombre,
  configSchema: z.strictObject({}),
  migraciones: [],
});

describe('registro de módulos', () => {
  it('contiene los módulos registrados por los slices', () => {
    expect(MODULOS.map((m) => m.nombre)).toContain('visibilidad');
  });

  it('pasa cada módulo por definirModulo', () => {
    expect(() => registrarModulos([def('Asig-nacion')])).toThrow(
      ErrorDefinicionModulo
    );
  });

  it('rechaza nombres repetidos', () => {
    expect(() => registrarModulos([def('demo'), def('demo')])).toThrow(/demo/);
  });

  it('conserva el orden de declaración y congela la lista', () => {
    const r = registrarModulos([def('b'), def('a')]);
    expect(r.map((m) => m.nombre)).toEqual(['b', 'a']);
    expect(Object.isFrozen(r)).toBe(true);
  });
});
