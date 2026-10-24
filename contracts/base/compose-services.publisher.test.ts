import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ComposeServiceSchema,
  ComposeVolumeSchema,
  OPTIONAL_SERVICE_NAMES,
  parseTopology,
  POSTGRES_PORTS,
  SERVICE_NAMES,
  VOLUME_NAMES,
} from './compose-services.js';
import {
  readComposeDocument,
  toTopologyInput,
} from '../../scripts/compose/topology.js';

// Publisher verification for interface I2 (slice CT.2).
// BASE.1 owns the docker-compose.yml these cases read; until it lands,
// the repo ships a single `app` service and there is nothing to verify.
// BASE.1 turns each `it.todo` into a real test (it also adds the YAML
// parser needed to read the compose file) — it must not delete them.
describe('publisher verification · docker-compose.yml satisfies CT.2 [BASE.1]', () => {
  // Parse the compose file once; all tests below share this result.
  const composePath = resolve(process.cwd(), 'docker-compose.yml');
  const input = toTopologyInput(readComposeDocument(composePath), {});
  const services = input.services.map((s) => ComposeServiceSchema.parse(s));

  it('reads docker-compose.yml and builds a ComposeTopology from its services and volumes', () => {
    expect(services.map((s) => s.name)).toEqual([
      'supabase-db',
      'supabase-kong',
      'supabase-auth',
      'supabase-rest',
      'supabase-realtime',
      'supabase-storage',
      'supabase-meta',
      'app',
      'cron',
      'tunnel',
    ]);
    expect(input.volumes.map((v) => ComposeVolumeSchema.parse(v).name)).toEqual(
      VOLUME_NAMES
    );
  });

  it('parses that topology with parseTopology without errors', () => {
    expect(() => parseTopology(input)).not.toThrow();
  });

  it('declares every required service of SERVICE_NAMES', () => {
    const declared = new Set(parseTopology(input).services.map((s) => s.name));
    const required = SERVICE_NAMES.filter(
      (n) => !(OPTIONAL_SERVICE_NAMES as readonly string[]).includes(n)
    );
    expect([...required].filter((n) => !declared.has(n))).toEqual([]);
  });

  it('declares every volume of VOLUME_NAMES', () => {
    const parsedVolumes = input.volumes.map((v) =>
      ComposeVolumeSchema.parse(v)
    );
    const volumeNames = new Set(parsedVolumes.map((v) => v.name));
    for (const name of VOLUME_NAMES) {
      expect(volumeNames).toContain(name);
    }
  });

  it('pins every image and uses :latest nowhere', () => {
    // ComposeServiceSchema already rejects :latest and un-tagged images when
    // parsing above; additionally assert that no non-app/cron service has
    // image null, and that the raw YAML contains no ":latest".
    for (const svc of services) {
      if (svc.role !== 'app' && svc.role !== 'cron') {
        expect(svc.image).not.toBeNull();
      }
    }
    const rawYaml = readFileSync(composePath, 'utf8');
    expect(rawYaml).not.toMatch(/:latest/);
  });

  it('publishes no Postgres port (5432, 6543) on the host', () => {
    for (const svc of services) {
      for (const port of svc.publishedPorts) {
        expect(POSTGRES_PORTS).not.toContain(port.host);
        expect(POSTGRES_PORTS).not.toContain(port.container);
      }
    }
  });

  it('gives every service a healthcheck', () => {
    const withoutHealthcheck = services.filter((s) => !s.healthcheck);
    expect(withoutHealthcheck).toEqual([]);
  });

  it('publishes only on the loopback interface', () => {
    // R1: no published port must bind on 0.0.0.0 or omit the IP.
    // We read the raw YAML because the host IP is not part of the contract shape.
    const rawYaml = readFileSync(composePath, 'utf8');
    // Collect short-form port entries (lines that look like: - '...:...')
    const allPortStrings = rawYaml
      .split('\n')
      .filter((l) => /^\s+- '[\d.[$].*:\d/.test(l))
      .map((l) => l.trim().replace(/^- '/, '').replace(/'$/, ''));

    for (const entry of allPortStrings) {
      // Must start with '127.0.0.1:' or a variable reference ('${...')
      const ok = entry.startsWith('127.0.0.1:') || entry.startsWith('${');
      expect(ok, `Port entry "${entry}" does not bind to 127.0.0.1`).toBe(true);
    }
  });
});

describe('BASE.2 · servicio tunnel: túnel saliente sin puertos en el host', () => {
  const input = toTopologyInput(
    readComposeDocument(resolve(process.cwd(), 'docker-compose.yml')),
    {}
  );
  const topology = parseTopology(input);
  const tunnel = topology.services.find((s) => s.name === 'tunnel');

  it('el servicio tunnel está en la topología con rol tunnel y healthcheck', () => {
    expect(tunnel).toBeDefined();
    expect(tunnel!.role).toBe('tunnel');
    expect(tunnel!.healthcheck).toBe(true);
  });

  it('el servicio tunnel no publica puertos en el host (R1)', () => {
    expect(tunnel!.publishedPorts).toHaveLength(0);
  });

  it('la imagen del tunnel está pineada, sin :latest (R3)', () => {
    expect(tunnel!.image).toMatch(/^cloudflare\/cloudflared:\d+\.\d+\.\d+$/);
  });

  it('el único servicio con puertos en el host publica solo en loopback', () => {
    const raw = readFileSync(resolve(process.cwd(), 'docker-compose.yml'), 'utf8');
    const entries = [...raw.matchAll(/^\s+- ['"]?([^'"\n]*\d+:\d+)['"]?$/gm)].map(
      (m) => m[1]!
    );
    for (const e of entries) expect(e).toMatch(/^127\.0\.0\.1:/);
  });
});
