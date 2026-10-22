/**
 * CDC BAK — Consumer Driven Contract tests for the BAK (daily backup) consumer.
 *
 * These tests document what the backup process expects from interface I2 (CT.2).
 * BAK.1 inherits this file as its contract of consumption; if the contract
 * changes, these tests must be updated first (not the other way around).
 */

import { describe, expect, it } from 'vitest';
import {
  backupVolumeNames,
  cronServiceName,
  databaseServiceName,
  parseTopology,
} from '@contracts/base/compose-services';
import {
  BASE_TOPOLOGY,
  BASE_TOPOLOGY_INPUT,
  createTopologyStub,
} from '@contracts/base/compose-services.stub';

describe('CDC BAK · lo que el backup diario espera de CT.2', () => {
  it('obtiene el nombre del servicio de base sin hardcodearlo', () => {
    expect(databaseServiceName(BASE_TOPOLOGY)).toBe('supabase-db');
  });

  it('obtiene el nombre del servicio de cron donde corre la tarea de las 3:00', () => {
    expect(cronServiceName(BASE_TOPOLOGY)).toBe('cron');
  });

  it('respalda la base y el storage, y nada más', () => {
    expect(backupVolumeNames(BASE_TOPOLOGY)).toEqual([
      'supabase-db-data',
      'supabase-storage-data',
    ]);
  });

  it('alcanza Postgres solo por la red del compose: el servicio de base no publica puertos', () => {
    const db = BASE_TOPOLOGY.services.find(
      (s) => s.name === databaseServiceName(BASE_TOPOLOGY)
    )!;
    expect(db.publishedPorts).toEqual([]);
  });

  it('nunca recibe una topología sin volumen de storage que respaldar', () => {
    const input = structuredClone(BASE_TOPOLOGY_INPUT);
    // Quita supabase-storage-data de volumes y de las referencias del servicio
    input.volumes = input.volumes.filter(
      (v) => (v as { name: string }).name !== 'supabase-storage-data'
    );
    const storage = input.services.find(
      (s) => (s as { name: string }).name === 'supabase-storage'
    ) as { volumes: string[] };
    storage.volumes = [];
    expect(() => parseTopology(input)).toThrow();
  });

  it('nunca recibe un volumen de la base marcado fuera del backup', () => {
    expect(() =>
      createTopologyStub({
        volumes: [
          { name: 'supabase-db-data', content: 'db', inBackup: false },
          { name: 'supabase-storage-data', content: 'storage', inBackup: true },
        ],
      })
    ).toThrow();
  });
});
