import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import {
  parsePortMapping,
  resolveEnvRef,
  toTopologyInput,
} from './topology.js';

// Helper: parse inline YAML into a document object
function doc(yamlStr: string): unknown {
  return yaml.load(yamlStr);
}

// ---------------------------------------------------------------------------
// resolveEnvRef
// ---------------------------------------------------------------------------

describe('resolveEnvRef', () => {
  it.each([
    ['${HOST_PORT:-3000}', {}, '3000'],
    ['${HOST_PORT:-3000}', { HOST_PORT: '8080' }, '8080'],
    ['${KONG_HTTP_PORT}', { KONG_HTTP_PORT: '8000' }, '8000'],
    ['5432', {}, '5432'],
  ] as const)('resolves %s with env %j to %s', (value, env, expected) => {
    expect(resolveEnvRef(value, env as Record<string, string | undefined>)).toBe(expected);
  });

  it('throws on a variable with no value and no default', () => {
    expect(() => resolveEnvRef('${KONG_HTTP_PORT}', {})).toThrow(/KONG_HTTP_PORT/);
  });
});

// ---------------------------------------------------------------------------
// parsePortMapping
// ---------------------------------------------------------------------------

describe('parsePortMapping', () => {
  it.each([
    ['3000:3000', { host: 3000, container: 3000 }],
    ['127.0.0.1:8000:8000', { host: 8000, container: 8000 }],
    ['127.0.0.1:${HOST_PORT:-3000}:3000', { host: 3000, container: 3000 }],
  ] as const)('reads short form %s', (entry, expected) => {
    expect(parsePortMapping(entry)).toEqual(expected);
  });

  it('reads the long form', () => {
    expect(parsePortMapping({ published: '8000', target: 8000 })).toEqual({
      host: 8000,
      container: 8000,
    });
  });
});

// ---------------------------------------------------------------------------
// toTopologyInput
// ---------------------------------------------------------------------------

describe('toTopologyInput', () => {
  it('maps a service to the contract shape', () => {
    const d = doc(`
services:
  supabase-db:
    image: supabase/postgres:15.8.1.060
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 30s
    volumes:
      - supabase-db-data:/var/lib/postgresql/data
    ports: []
volumes:
  supabase-db-data: {}
`);
    const result = toTopologyInput(d);
    expect(result.services).toHaveLength(1);
    const svc = result.services[0] as Record<string, unknown>;
    expect(svc['name']).toBe('supabase-db');
    expect(svc['role']).toBe('db');
    expect(svc['image']).toBe('supabase/postgres:15.8.1.060');
    expect(svc['healthcheck']).toBe(true);
    expect(svc['volumes']).toEqual(['supabase-db-data']);
    expect(svc['publishedPorts']).toEqual([]);
  });

  it('reports image null for a service that only builds', () => {
    const d = doc(`
services:
  app:
    build:
      context: .
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000').then(r=>process.exit(0))"]
volumes: {}
`);
    const result = toTopologyInput(d);
    const svc = result.services[0] as Record<string, unknown>;
    expect(svc['image']).toBeNull();
  });

  it('keeps the image of a service that both builds and tags', () => {
    const d = doc(`
services:
  cron:
    build:
      context: ./docker/cron
    image: wacrm/cron:1.0.0
    healthcheck:
      test: ["CMD", "true"]
volumes: {}
`);
    const result = toTopologyInput(d);
    const svc = result.services[0] as Record<string, unknown>;
    expect(svc['image']).toBe('wacrm/cron:1.0.0');
  });

  it('counts only named volumes, not bind mounts', () => {
    const d = doc(`
services:
  supabase-db:
    image: supabase/postgres:15.8.1.060
    healthcheck:
      test: ["CMD", "pg_isready"]
    volumes:
      - supabase-db-data:/var/lib/postgresql/data
      - ./supabase/migrations:/migrations:ro
volumes:
  supabase-db-data: {}
`);
    const result = toTopologyInput(d);
    const svc = result.services[0] as Record<string, unknown>;
    expect(svc['volumes']).toEqual(['supabase-db-data']);
  });

  it('reports healthcheck false when there is none', () => {
    const d = doc(`
services:
  supabase-db:
    image: supabase/postgres:15.8.1.060
volumes: {}
`);
    const result = toTopologyInput(d);
    const svc = result.services[0] as Record<string, unknown>;
    expect(svc['healthcheck']).toBe(false);
  });

  it('reports healthcheck false when it is disabled', () => {
    const d = doc(`
services:
  supabase-db:
    image: supabase/postgres:15.8.1.060
    healthcheck:
      disable: true
volumes: {}
`);
    const result = toTopologyInput(d);
    const svc = result.services[0] as Record<string, unknown>;
    expect(svc['healthcheck']).toBe(false);
  });

  it('reports healthcheck false when it has no test', () => {
    const d = doc(`
services:
  supabase-db:
    image: supabase/postgres:15.8.1.060
    healthcheck:
      interval: 30s
      timeout: 5s
volumes: {}
`);
    const result = toTopologyInput(d);
    const svc = result.services[0] as Record<string, unknown>;
    expect(svc['healthcheck']).toBe(false);
  });

  it('keeps an unpinned or :latest image verbatim so the contract can reject it', () => {
    const d = doc(`
services:
  supabase-kong:
    image: kong:latest
    healthcheck:
      test: ["CMD", "kong", "health"]
volumes: {}
`);
    const result = toTopologyInput(d);
    const svc = result.services[0] as Record<string, unknown>;
    // The reader does not validate — it passes through; the schema rejects it
    expect(svc['image']).toBe('kong:latest');
  });

  it('throws on a service name the contract does not know', () => {
    expect(() =>
      toTopologyInput(
        doc(`
services:
  db:
    image: x:1.0.0
    healthcheck:
      test: ["CMD", "true"]
volumes: {}
`),
      ),
    ).toThrow(/db/);
  });

  it('maps the declared volumes with their content and inBackup true', () => {
    const d = doc(`
services:
  supabase-db:
    image: supabase/postgres:15.8.1.060
    healthcheck:
      test: ["CMD", "pg_isready"]
    volumes:
      - supabase-db-data:/var/lib/postgresql/data
  supabase-storage:
    image: supabase/storage-api:v1.11.13
    healthcheck:
      test: ["CMD", "wget", "--spider", "http://localhost:5000/status"]
    volumes:
      - supabase-storage-data:/var/lib/storage
volumes:
  supabase-db-data: {}
  supabase-storage-data: {}
`);
    const result = toTopologyInput(d);
    expect(result.volumes).toHaveLength(2);
    const dbVol = (result.volumes as Array<Record<string, unknown>>).find(
      (v) => v['name'] === 'supabase-db-data',
    );
    const stVol = (result.volumes as Array<Record<string, unknown>>).find(
      (v) => v['name'] === 'supabase-storage-data',
    );
    expect(dbVol).toMatchObject({ name: 'supabase-db-data', content: 'db', inBackup: true });
    expect(stVol).toMatchObject({ name: 'supabase-storage-data', content: 'storage', inBackup: true });
  });

  it('throws on a declared volume the contract does not know', () => {
    expect(() =>
      toTopologyInput(
        doc(`
services:
  supabase-db:
    image: supabase/postgres:15.8.1.060
    healthcheck:
      test: ["CMD", "pg_isready"]
volumes:
  pgdata: {}
`),
      ),
    ).toThrow(/pgdata/);
  });
});
