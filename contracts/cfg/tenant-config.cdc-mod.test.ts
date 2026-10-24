import { describe, expect, it } from 'vitest';
import { ModulosSchema, moduloDe } from './tenant-config';
import { stubTenantConfig } from './tenant-config.stub';

describe('CDC MOD.1 · interruptores de módulos', () => {
  it('por defecto los módulos vienen apagados', () => {
    expect(moduloDe(stubTenantConfig(), 'asignacion')?.activo).toBe(false);
  });

  it('lee un módulo encendido con su config', () => {
    const config = stubTenantConfig({
      modulos: {
        asignacion: { activo: true, config: { estrategia: 'round-robin' } },
      },
    });
    const modulo = moduloDe(config, 'asignacion');
    expect(modulo?.activo).toBe(true);
    expect(modulo?.config).toEqual({ estrategia: 'round-robin' });
  });

  it('devuelve undefined para un módulo que la empresa no declaró', () => {
    expect(moduloDe(stubTenantConfig(), 'visibilidad')).toBeUndefined();
  });

  it('no opina sobre la forma de la config de un módulo (eso es CT.3)', () => {
    expect(() =>
      ModulosSchema.parse({
        visibilidad: { activo: true, config: { lo: { que: ['sea'] } } },
      })
    ).not.toThrow();
  });

  it('exige el interruptor y rechaza un nombre de módulo inválido', () => {
    expect(() => ModulosSchema.parse({ asignacion: { config: {} } })).toThrow();
    expect(() =>
      ModulosSchema.parse({ Asignacion: { activo: true } })
    ).toThrow();
  });

  it('deja la config de un módulo en {} cuando no se pasa', () => {
    const config = stubTenantConfig({
      modulos: { asignacion: { activo: true } },
    });
    expect(moduloDe(config, 'asignacion')?.config).toEqual({});
  });
});
