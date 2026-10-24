import { describe, expect, it } from 'vitest';
import {
  HORA_BACKUP,
  RUTAS_EMPRESA,
  TenantConfigSchema,
  esRutaDeEmpresa,
} from './tenant-config';
import { stubRutasEmpresa, stubTenantConfig } from './tenant-config.stub';

describe('el stub sale del contrato', () => {
  it('devuelve una config que el esquema acepta', () => {
    expect(() => TenantConfigSchema.parse(stubTenantConfig())).not.toThrow();
  });

  it('aplica la hora fija del backup sin que nadie la pase', () => {
    expect(stubTenantConfig().backup.hora).toBe(HORA_BACKUP);
  });

  it('deja aplicar overrides parciales', () => {
    const config = stubTenantConfig({ empresa: { id: 'baru' } });
    expect(config.empresa.id).toBe('baru');
    expect(config.empresa.nombre).not.toHaveLength(0);
  });

  it('hace fallar un override que rompe el contrato', () => {
    expect(() =>
      stubTenantConfig({ backup: { destinoUri: 'http://ejemplo.com' } })
    ).toThrow();
  });

  it('rechaza una llave desconocida en vez de ignorarla', () => {
    expect(() =>
      TenantConfigSchema.parse({ ...stubTenantConfig(), backps: {} })
    ).toThrow();
  });

  it('expone las rutas de la empresa que el contrato clasifica como suyas', () => {
    expect(stubRutasEmpresa()).toEqual(
      expect.arrayContaining([...RUTAS_EMPRESA])
    );
    for (const ruta of stubRutasEmpresa()) {
      expect(esRutaDeEmpresa(ruta)).toBe(true);
    }
  });
});
