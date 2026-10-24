import type { z } from 'zod';
import {
  backupVolumeNames,
  databaseServiceName,
  parseTopology,
  type ComposeTopology,
  type ComposeTopologyInput,
} from '@contracts/base/compose-services';
import { BackupConfigSchema } from '@contracts/cfg/tenant-config';

export type BackupConfig = z.infer<typeof BackupConfigSchema>;

export const VOLUME_MOUNT_ROOT = '/var/lib';

/** Reads the tenant backup settings through the CT.1 schema. Throws ZodError. */
export function backupConfigFromEnv(
  env: Record<string, string | undefined>
): BackupConfig {
  return BackupConfigSchema.parse({
    destinoUri: env.BACKUP_DESTINO_URI,
    credencial: env.BACKUP_DESTINO_CREDENCIAL,
    avisoWebhook: env.BACKUP_AVISO_WEBHOOK,
  });
}

/**
 * Reads BACKUP_DB_URL and checks its host is the db service named by CT.2.
 * Error messages never include the URL (it carries the password).
 */
export function databaseUrlFromEnv(
  env: Record<string, string | undefined>,
  topology: ComposeTopology
): string {
  const service = databaseServiceName(topology);
  const raw = env.BACKUP_DB_URL;
  if (!raw) throw new Error('BACKUP_DB_URL is required');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('BACKUP_DB_URL is not a valid URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('BACKUP_DB_URL must be a postgres URL');
  }
  if (url.hostname !== service) {
    throw new Error(`BACKUP_DB_URL host must be the db service "${service}"`);
  }
  return raw;
}

const aux = (name: string, image: string) => ({
  name,
  role: 'aux',
  image,
  healthcheck: true,
  publishedPorts: [],
  volumes: [],
});

/** Topology production code validates against; mirrors the CT.2 stub names. */
export const TEMPLATE_TOPOLOGY_INPUT: ComposeTopologyInput = {
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
    aux('supabase-auth', 'supabase/gotrue:v2.177.0'),
    aux('supabase-rest', 'postgrest/postgrest:v12.2.12'),
    aux('supabase-realtime', 'supabase/realtime:v2.34.47'),
    {
      name: 'supabase-storage',
      role: 'storage',
      image: 'supabase/storage-api:v1.19.3',
      healthcheck: true,
      publishedPorts: [],
      volumes: ['supabase-storage-data'],
    },
    aux('supabase-meta', 'supabase/postgres-meta:v0.87.1'),
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

export function templateTopology(): ComposeTopology {
  return parseTopology(structuredClone(TEMPLATE_TOPOLOGY_INPUT));
}

export type BackupArtifact =
  | { kind: 'database'; service: string; fileName: string }
  | { kind: 'volume'; volume: string; sourcePath: string; fileName: string };

export function backupArtifacts(topology: ComposeTopology): BackupArtifact[] {
  const service = databaseServiceName(topology);
  return [
    { kind: 'database', service, fileName: `${service}.dump` },
    ...backupVolumeNames(topology).map((volume): BackupArtifact => ({
      kind: 'volume',
      volume,
      sourcePath: `${VOLUME_MOUNT_ROOT}/${volume}`,
      fileName: `${volume}.tar.gz`,
    })),
  ];
}

/** S3-safe timestamp folder: ISO with ':' and '.' replaced by '-'. */
export function destinationFolder(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}
