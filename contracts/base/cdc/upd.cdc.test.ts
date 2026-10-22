/**
 * CDC UPD — Consumer Driven Contract tests for the UPD (update checker) consumer.
 *
 * These tests document what the update checker expects from interface I2 (CT.2).
 * UPD.1 inherits this file as its contract of consumption; if the contract
 * changes, these tests must be updated first (not the other way around).
 */

import { describe, expect, it } from 'vitest';
import {
  ComposeTopologySchema,
  OPTIONAL_SERVICE_NAMES,
  SERVICE_NAMES,
  VOLUME_NAMES,
  nameChanges,
  parseTopology,
} from '@contracts/base/compose-services';
import {
  BASE_TOPOLOGY,
  BASE_TOPOLOGY_INPUT,
} from '@contracts/base/compose-services.stub';

describe('CDC UPD · lo que el chequeo de actualización espera de CT.2', () => {
  it('tiene una lista cerrada de nombres contra la que comparar un compose candidato', () => {
    expect(SERVICE_NAMES).toHaveLength(11);
    expect(VOLUME_NAMES).toHaveLength(2);
    expect(new Set(SERVICE_NAMES).size).toBe(SERVICE_NAMES.length);
  });

  it('detecta que la plantilla renombró un servicio', () => {
    const changes = nameChanges(BASE_TOPOLOGY, {
      services: BASE_TOPOLOGY.services.map((s) =>
        s.name === 'supabase-db' ? 'db' : s.name
      ),
      volumes: BASE_TOPOLOGY.volumes.map((v) => v.name),
    });
    expect(changes.removedServices).toEqual(['supabase-db']);
    expect(changes.addedServices).toEqual(['db']);
  });

  it('detecta que la plantilla renombró un volumen', () => {
    const changes = nameChanges(BASE_TOPOLOGY, {
      services: BASE_TOPOLOGY.services.map((s) => s.name),
      volumes: ['supabase-db-data', 'storage-data'],
    });
    expect(changes.removedVolumes).toEqual(['supabase-storage-data']);
    expect(changes.addedVolumes).toEqual(['storage-data']);
  });

  it('reporta el nombre ofensor en el path del issue, para poder mostrarlo en el diff', () => {
    const input = structuredClone(BASE_TOPOLOGY_INPUT);
    (input.services[0] as { name: string }).name = 'db';
    const result = ComposeTopologySchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(
      (
        result as {
          success: false;
          error: { issues: { path: (string | number)[] }[] };
        }
      ).error.issues.some((i) => i.path.join('.') === 'services.0.name')
    ).toBe(true);
  });

  it('acepta que un servicio opcional aparezca o desaparezca sin ser un cambio de contrato', () => {
    const changes = nameChanges(BASE_TOPOLOGY, {
      services: [...BASE_TOPOLOGY.services.map((s) => s.name), 'tunnel'],
      volumes: BASE_TOPOLOGY.volumes.map((v) => v.name),
    });
    expect(changes.addedServices).toEqual(['tunnel']);
    expect(OPTIONAL_SERVICE_NAMES).toContain('tunnel');
  });

  it('rechaza un compose candidato al que le falta un servicio obligatorio', () => {
    const input = structuredClone(BASE_TOPOLOGY_INPUT);
    input.services = input.services.filter(
      (s) => (s as { name: string }).name !== 'supabase-storage'
    );
    expect(() => parseTopology(input)).toThrow();
  });
});
