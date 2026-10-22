/**
 * Reference topology for interface I2 (slice CT.2), phase 1.
 *
 * This stub is derived by passing BASE_TOPOLOGY_INPUT through parseTopology,
 * so it can never diverge from the contract schema. BASE.1 will replace the
 * it.todo publisher verification tests once the real docker-compose.yml lands.
 *
 * Image tags here are fixtures — the contract only requires them to be pinned
 * and not :latest. BASE.1 picks the real versions.
 */

import {
  type ComposeTopology,
  type ComposeTopologyInput,
  parseTopology,
} from '@contracts/base/compose-services';

export const BASE_TOPOLOGY_INPUT: ComposeTopologyInput = {
  services: [
    {
      name: 'supabase-db',
      role: 'db',
      image: 'supabase/postgres:15.8.1.060',
      healthcheck: true,
      publishedPorts: [],
      volumes: ['supabase-db-data'],
    },
    {
      name: 'supabase-kong',
      role: 'gateway',
      image: 'kong:2.8.1',
      healthcheck: true,
      publishedPorts: [{ host: 8000, container: 8000 }],
      volumes: [],
    },
    {
      name: 'supabase-auth',
      role: 'aux',
      image: 'supabase/gotrue:v2.177.0',
      healthcheck: true,
      publishedPorts: [],
      volumes: [],
    },
    {
      name: 'supabase-rest',
      role: 'aux',
      image: 'postgrest/postgrest:v12.2.12',
      healthcheck: true,
      publishedPorts: [],
      volumes: [],
    },
    {
      name: 'supabase-realtime',
      role: 'aux',
      image: 'supabase/realtime:v2.34.47',
      healthcheck: true,
      publishedPorts: [],
      volumes: [],
    },
    {
      name: 'supabase-storage',
      role: 'storage',
      image: 'supabase/storage-api:v1.19.3',
      healthcheck: true,
      publishedPorts: [],
      volumes: ['supabase-storage-data'],
    },
    {
      name: 'supabase-meta',
      role: 'aux',
      image: 'supabase/postgres-meta:v0.87.1',
      healthcheck: true,
      publishedPorts: [],
      volumes: [],
    },
    {
      name: 'app',
      role: 'app',
      image: null,
      healthcheck: true,
      publishedPorts: [{ host: 3000, container: 3000 }],
      volumes: [],
    },
    {
      name: 'cron',
      role: 'cron',
      image: null,
      healthcheck: true,
      publishedPorts: [],
      volumes: [],
    },
  ],
  volumes: [
    { name: 'supabase-db-data', content: 'db', inBackup: true },
    { name: 'supabase-storage-data', content: 'storage', inBackup: true },
  ],
};

export const BASE_TOPOLOGY: ComposeTopology =
  parseTopology(BASE_TOPOLOGY_INPUT);

/**
 * Creates a new topology stub by merging overrides into BASE_TOPOLOGY_INPUT
 * and parsing the result. Each call returns an independent object.
 * Throws ZodError if the overrides produce an invalid topology.
 */
export function createTopologyStub(
  overrides?: Partial<ComposeTopologyInput>
): ComposeTopology {
  return parseTopology(
    structuredClone({ ...BASE_TOPOLOGY_INPUT, ...overrides })
  );
}
