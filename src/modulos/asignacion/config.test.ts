import { describe, expect, it } from 'vitest';
import { ConfigAsignacionSchema } from './config';

describe('ConfigAsignacionSchema', () => {
  it('vacía aplica el orden por defecto', () => {
    expect(ConfigAsignacionSchema.parse({})).toEqual({
      reglas: [
        'asesor-previo',
        'etiqueta',
        'palabra-clave',
        'campo',
        'reparto-equitativo',
      ],
    });
  });
  it('acepta los tipos de ASG.2 en cualquier orden antes del reparto', () => {
    expect(
      ConfigAsignacionSchema.parse({
        reglas: ['campo', 'etiqueta', 'reparto-equitativo'],
      }).reglas
    ).toEqual(['campo', 'etiqueta', 'reparto-equitativo']);
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
    [{ reglas: ['etiqueta', 'etiqueta'] }],
    [{ reglas: ['reparto-equitativo', 'campo'] }],
    [{ reglas: ['ciudad'] }],
    [{ reglas: ['asesor-previo'], extra: 1 }],
  ])('rechaza %j', (cfg) => {
    expect(ConfigAsignacionSchema.safeParse(cfg).success).toBe(false);
  });
});
