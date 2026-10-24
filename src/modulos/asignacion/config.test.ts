import { describe, expect, it } from 'vitest';
import { ConfigAsignacionSchema } from './config';

describe('ConfigAsignacionSchema', () => {
  it('vacía aplica el orden por defecto', () => {
    expect(ConfigAsignacionSchema.parse({})).toEqual({
      reglas: ['asesor-previo', 'reparto-equitativo'],
    });
  });
  it('acepta solo el reparto', () => {
    expect(
      ConfigAsignacionSchema.parse({ reglas: ['reparto-equitativo'] }).reglas
    ).toEqual(['reparto-equitativo']);
  });
  it.each([
    [{ reglas: [] }],
    [{ reglas: ['por-ia'] }],
    [{ reglas: ['asesor-previo', 'asesor-previo'] }],
    [{ reglas: ['reparto-equitativo', 'asesor-previo'] }],
    [{ reglas: ['asesor-previo'], extra: 1 }],
  ])('rechaza %j', (cfg) => {
    expect(ConfigAsignacionSchema.safeParse(cfg).success).toBe(false);
  });
});
