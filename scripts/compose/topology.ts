/**
 * Reads docker-compose.yml and translates it into the ComposeTopologyInput
 * shape that CT.2 defines. This is the single place that knows how to parse
 * the compose file; validation (pins, port rules, service completeness) is
 * done by CT.2's ComposeServiceSchema / parseTopology — not here.
 */

import * as yaml from 'js-yaml';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type ComposeTopologyInput,
  type ServiceName,
  type ServiceRole,
  type VolumeName,
  SERVICE_NAMES,
  VOLUME_NAMES,
} from '@contracts/base/compose-services';

// ---------------------------------------------------------------------------
// Role + volume-content mappings (source of truth: this file)
// ---------------------------------------------------------------------------

export const SERVICE_ROLE_BY_NAME: Readonly<Record<ServiceName, ServiceRole>> =
  {
    'supabase-db': 'db',
    'supabase-kong': 'gateway',
    'supabase-auth': 'aux',
    'supabase-rest': 'aux',
    'supabase-realtime': 'aux',
    'supabase-storage': 'storage',
    'supabase-studio': 'aux',
    'supabase-meta': 'aux',
    app: 'app',
    cron: 'cron',
    tunnel: 'tunnel',
  };

export const VOLUME_CONTENT_BY_NAME: Readonly<
  Record<VolumeName, 'db' | 'storage'>
> = {
  'supabase-db-data': 'db',
  'supabase-storage-data': 'storage',
};

// ---------------------------------------------------------------------------
// Env-ref resolver
// ---------------------------------------------------------------------------

/**
 * Resolves every `${NAME}` and `${NAME:-default}` occurrence in `value`.
 * Subset of Compose variable substitution; only what this repo uses.
 * Throws if a variable has no value and no default.
 */
export function resolveEnvRef(
  value: string,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string {
  return value.replace(
    /\$\{([A-Z_][A-Z0-9_]*)(?::-(.*?))?\}/g,
    (_, name: string, def: string | undefined) => {
      const val = env[name];
      if (val !== undefined) return val;
      if (def !== undefined) return def;
      throw new Error(`Unresolved Compose variable: ${name}`);
    },
  );
}

// ---------------------------------------------------------------------------
// Port-mapping parser
// ---------------------------------------------------------------------------

/**
 * Parses one entry from a service's `ports:` list.
 * Supports:
 *   - short form strings: "host:container", "ip:host:container",
 *     "${VAR:-def}:container"
 *   - long form objects: { published: "8000", target: 8000 }
 */
export function parsePortMapping(
  entry: unknown,
  env: Record<string, string | undefined> = {},
): { host: number; container: number } {
  if (entry !== null && typeof entry === 'object') {
    const e = entry as Record<string, unknown>;
    const host = parseInt(
      resolveEnvRef(String(e['published'] ?? e['target']), env),
      10,
    );
    const container = parseInt(String(e['target']), 10);
    return { host, container };
  }

  const str = resolveEnvRef(String(entry), env);
  // "ip:host:container" or "host:container"
  const parts = str.split(':');
  const container = parseInt(parts[parts.length - 1]!, 10);
  const host = parseInt(parts[parts.length - 2]!, 10);
  return { host, container };
}

// ---------------------------------------------------------------------------
// Compose document reader
// ---------------------------------------------------------------------------

/** Loads the YAML file at `path` (defaults to `docker-compose.yml` in cwd). */
export function readComposeDocument(path?: string): unknown {
  const p = path ?? resolve(process.cwd(), 'docker-compose.yml');
  return yaml.load(readFileSync(p, 'utf8'));
}

// ---------------------------------------------------------------------------
// Compose → ComposeTopologyInput
// ---------------------------------------------------------------------------

type RawService = {
  image?: string;
  build?: unknown;
  healthcheck?: {
    disable?: boolean;
    test?: unknown;
    [k: string]: unknown;
  };
  ports?: unknown[];
  volumes?: unknown[];
  [k: string]: unknown;
};

type RawDocument = {
  services: Record<string, RawService>;
  volumes?: Record<string, unknown>;
};

/**
 * Translates a raw compose document (as returned by readComposeDocument) into
 * the ComposeTopologyInput that CT.2 expects.
 *
 * Rules:
 * - service name must be in SERVICE_NAMES; throws otherwise
 * - volume name (top-level) must be in VOLUME_NAMES; throws otherwise
 * - only named volumes (those listed under top-level `volumes:`) are included
 *   per service — bind mounts are filtered out
 * - healthcheck is true only when a `test` key exists and `disable` is not true
 * - image is taken from `image:` if present; null when the service only builds
 */
export function toTopologyInput(
  document: unknown,
  env: Record<string, string | undefined> = {},
): ComposeTopologyInput {
  const doc = document as RawDocument;
  const topLevelVolumeNames = Object.keys(doc.volumes ?? {});

  const services = Object.entries(doc.services).map(([name, svc]) => {
    if (!(SERVICE_NAMES as readonly string[]).includes(name)) {
      throw new Error(
        `Unknown service name: "${name}". Valid names: ${SERVICE_NAMES.join(', ')}`,
      );
    }

    const role = SERVICE_ROLE_BY_NAME[name as ServiceName];

    // Image: present → use it; build-only → null
    const image: string | null =
      typeof svc.image === 'string' ? svc.image : null;

    // Healthcheck: true only when test exists and not disabled
    let healthcheck: boolean;
    if (
      svc.healthcheck === undefined ||
      svc.healthcheck === null ||
      typeof svc.healthcheck !== 'object'
    ) {
      healthcheck = false;
    } else if (svc.healthcheck.disable === true) {
      healthcheck = false;
    } else {
      healthcheck = svc.healthcheck.test !== undefined;
    }

    // Published ports
    const rawPorts = Array.isArray(svc.ports) ? svc.ports : [];
    const publishedPorts = rawPorts.map((p) => parsePortMapping(p, env));

    // Named volumes only (filter out bind mounts)
    const rawVolumes = Array.isArray(svc.volumes) ? svc.volumes : [];
    const volumes = rawVolumes
      .map((v) => {
        if (typeof v === 'string') return v.split(':')[0]!;
        if (v !== null && typeof v === 'object') {
          const vo = v as Record<string, unknown>;
          return String(vo['source'] ?? '');
        }
        return '';
      })
      .filter((v) => topLevelVolumeNames.includes(v));

    return { name, role, image, healthcheck, publishedPorts, volumes };
  });

  const volumes = Object.keys(doc.volumes ?? {}).map((name) => {
    if (!(VOLUME_NAMES as readonly string[]).includes(name)) {
      throw new Error(
        `Unknown volume name: "${name}". Valid names: ${VOLUME_NAMES.join(', ')}`,
      );
    }
    const vName = name as VolumeName;
    return {
      name: vName,
      content: VOLUME_CONTENT_BY_NAME[vName],
      inBackup: true,
    };
  });

  return { services, volumes };
}
