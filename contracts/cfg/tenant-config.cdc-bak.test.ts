import { describe, expect, it } from 'vitest';
import {
  BackupConfigSchema,
  HORA_BACKUP,
  esVariableDeEmpresa,
} from './tenant-config';
import { stubTenantConfig } from './tenant-config.stub';

describe('CDC BAK.1 · destino y aviso del backup', () => {
  it('lee destino, credencial y aviso de la config de la empresa', () => {
    const { backup } = stubTenantConfig();
    expect(backup.destinoUri).toMatch(/^(s3|b2|gs|file):\/\//);
    expect(backup.credencial.length).toBeGreaterThan(0);
    expect(backup.avisoWebhook).toMatch(/^https?:\/\//);
  });

  it('corre a las 3:00 y no deja cambiar la hora', () => {
    expect(stubTenantConfig().backup.hora).toBe(HORA_BACKUP);
    expect(() => stubTenantConfig({ backup: { hora: '04:00' } })).toThrow();
  });

  it.each([
    'http://ejemplo.com/backups',
    'backups/',
    '',
    's3:/falta-una-barra',
  ])('rechaza el destino %s', (destinoUri) => {
    const { backup } = stubTenantConfig();
    expect(() => BackupConfigSchema.parse({ ...backup, destinoUri })).toThrow();
  });

  it('rechaza credencial vacía y aviso que no es URL', () => {
    const { backup } = stubTenantConfig();
    expect(() =>
      BackupConfigSchema.parse({ ...backup, credencial: '' })
    ).toThrow();
    expect(() =>
      BackupConfigSchema.parse({ ...backup, avisoWebhook: 'avisame' })
    ).toThrow();
  });

  it('rechaza una llave desconocida (p. ej. destinoUrl mal escrita)', () => {
    const { backup } = stubTenantConfig();
    expect(() =>
      BackupConfigSchema.parse({ ...backup, destinoUrl: 's3://otro' })
    ).toThrow();
  });

  it('deja los secretos del backup del lado de la empresa', () => {
    for (const nombre of [
      'BACKUP_DESTINO_URI',
      'BACKUP_DESTINO_CREDENCIAL',
      'BACKUP_AVISO_WEBHOOK',
    ]) {
      expect(esVariableDeEmpresa(nombre)).toBe(true);
    }
  });
});
