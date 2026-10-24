import { describe, expect, it } from 'vitest';
import { BASE_TOPOLOGY } from '@contracts/base/compose-services.stub';
import { HORA_BACKUP } from '@contracts/cfg/tenant-config';
import { stubTenantConfig } from '@contracts/cfg/tenant-config.stub';
import {
  backupArtifacts,
  backupConfigFromEnv,
  databaseUrlFromEnv,
  destinationFolder,
  templateTopology,
} from './contrato';

const env = {
  BACKUP_DESTINO_URI: 's3://backups-demo/empresa-demo',
  BACKUP_DESTINO_CREDENCIAL:
    'type = s3\naccess_key_id = ak\nsecret_access_key = sk',
  BACKUP_AVISO_WEBHOOK: 'https://avisos.example.com/backup',
  BACKUP_DB_URL: 'postgresql://postgres:pw@supabase-db:5432/postgres',
};

describe('backupConfigFromEnv', () => {
  it('reads the tenant backup settings through the CT.1 schema', () => {
    const config = backupConfigFromEnv(env);
    expect(config.destinoUri).toBe('s3://backups-demo/empresa-demo');
    expect(config.credencial.length).toBeGreaterThan(0);
    expect(config.avisoWebhook).toBe('https://avisos.example.com/backup');
    expect(config.hora).toBe(HORA_BACKUP);
  });

  it('accepts every destination scheme the contract allows', () => {
    for (const uri of [
      's3://b/p',
      'b2://b/p',
      'gs://b/p',
      'file:///var/backups',
    ]) {
      expect(
        backupConfigFromEnv({ ...env, BACKUP_DESTINO_URI: uri }).destinoUri
      ).toBe(uri);
    }
  });

  it.each([
    { BACKUP_DESTINO_URI: 'http://backups.example.com' },
    { BACKUP_DESTINO_CREDENCIAL: '' },
    { BACKUP_AVISO_WEBHOOK: 'avisame' },
    { BACKUP_DESTINO_URI: undefined },
  ])('refuses a tenant config the contract rejects: %o', (patch) => {
    expect(() => backupConfigFromEnv({ ...env, ...patch })).toThrow();
  });

  it('devuelve la misma forma que el stub de CT.1 le entrega a BAK', () => {
    expect(Object.keys(backupConfigFromEnv(env)).sort()).toEqual(
      Object.keys(stubTenantConfig().backup).sort()
    );
  });
});

describe('databaseUrlFromEnv', () => {
  it('takes the url from the environment when it points at the contract service', () => {
    expect(databaseUrlFromEnv(env, BASE_TOPOLOGY)).toBe(env.BACKUP_DB_URL);
  });

  it('refuses a url whose host is not the service CT.2 names', () => {
    expect(() =>
      databaseUrlFromEnv(
        { ...env, BACKUP_DB_URL: 'postgresql://postgres:pw@db:5432/postgres' },
        BASE_TOPOLOGY
      )
    ).toThrow(/supabase-db/);
  });

  it('refuses a missing or non-postgres url', () => {
    expect(() =>
      databaseUrlFromEnv({ ...env, BACKUP_DB_URL: undefined }, BASE_TOPOLOGY)
    ).toThrow();
    expect(() =>
      databaseUrlFromEnv(
        { ...env, BACKUP_DB_URL: 'mysql://supabase-db:3306/x' },
        BASE_TOPOLOGY
      )
    ).toThrow();
  });
});

describe('templateTopology', () => {
  it('matches the names of the CT.2 stub, so it cannot drift from the contract', () => {
    expect(templateTopology().services.map((s) => s.name)).toEqual(
      BASE_TOPOLOGY.services.map((s) => s.name)
    );
    expect(templateTopology().volumes.map((v) => v.name)).toEqual(
      BASE_TOPOLOGY.volumes.map((v) => v.name)
    );
  });
});

describe('backupArtifacts', () => {
  it('names the database dump after the CT.2 db service', () => {
    const [first] = backupArtifacts(BASE_TOPOLOGY);
    expect(first).toEqual({
      kind: 'database',
      service: 'supabase-db',
      fileName: 'supabase-db.dump',
    });
  });

  it('names one archive per CT.2 backup volume, mounted under /var/lib', () => {
    expect(backupArtifacts(BASE_TOPOLOGY).slice(1)).toEqual([
      {
        kind: 'volume',
        volume: 'supabase-db-data',
        sourcePath: '/var/lib/supabase-db-data',
        fileName: 'supabase-db-data.tar.gz',
      },
      {
        kind: 'volume',
        volume: 'supabase-storage-data',
        sourcePath: '/var/lib/supabase-storage-data',
        fileName: 'supabase-storage-data.tar.gz',
      },
    ]);
  });

  it('fails loudly when the topology renamed the database service', () => {
    const renamed = {
      ...BASE_TOPOLOGY,
      services: BASE_TOPOLOGY.services.filter((s) => s.role !== 'db'),
    };
    expect(() => backupArtifacts(renamed)).toThrow();
  });
});

describe('destinationFolder', () => {
  it('is an S3-safe timestamp', () => {
    expect(destinationFolder(new Date('2026-10-21T03:00:00.000Z'))).toBe(
      '2026-10-21T03-00-00-000Z'
    );
  });
});
