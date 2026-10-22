/**
 * Contract for interface I2: service names and volumes of the compose file.
 * Published by: BASE
 * Consumed by: BAK, UPD
 *
 * This file is the single source of truth for I2. Do not change it without
 * first updating the PRD in prd-hub (wacrm-tenant-repo-template/04-modulos.md#i2).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Canonical names (interface I2)
// ---------------------------------------------------------------------------

export const SERVICE_NAMES = [
  'supabase-db',
  'supabase-kong',
  'supabase-auth',
  'supabase-rest',
  'supabase-realtime',
  'supabase-storage',
  'supabase-studio',
  'supabase-meta',
  'app',
  'cron',
  'tunnel',
] as const;

export const OPTIONAL_SERVICE_NAMES = ['supabase-studio', 'tunnel'] as const;

export const VOLUME_NAMES = [
  'supabase-db-data',
  'supabase-storage-data',
] as const;

export const SERVICE_ROLES = [
  'db',
  'gateway',
  'storage',
  'app',
  'cron',
  'tunnel',
  'aux',
] as const;

export const POSTGRES_PORTS = [5432, 6543] as const;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ServiceNameSchema = z.enum(SERVICE_NAMES);
export const VolumeNameSchema = z.enum(VOLUME_NAMES);
export const ServiceRoleSchema = z.enum(SERVICE_ROLES);

export type ServiceName = z.infer<typeof ServiceNameSchema>;
export type VolumeName = z.infer<typeof VolumeNameSchema>;
export type ServiceRole = z.infer<typeof ServiceRoleSchema>;

// ---------------------------------------------------------------------------
// Schemas for individual service / volume entries
// ---------------------------------------------------------------------------

/**
 * A pinned image reference.
 * Must have a tag and that tag cannot be "latest" or empty.
 * Examples: "supabase/postgres:15.8.1.060", "kong:2.8.1", "ghcr.io/org/app:v1.2.3"
 */
export const ImageRefSchema = z
  .string()
  .regex(/^[^\s:]+(?:\/[^\s:]+)*:(?!latest$)[A-Za-z0-9][\w.-]*$/, {
    message: 'Image must have a pinned tag (not empty, not :latest)',
  });

export const PublishedPortSchema = z.strictObject({
  host: z.number().int().min(1).max(65535),
  container: z.number().int().min(1).max(65535),
});

export const ComposeServiceSchema = z
  .strictObject({
    name: ServiceNameSchema,
    role: ServiceRoleSchema,
    image: ImageRefSchema.nullable(),
    healthcheck: z.literal(true),
    publishedPorts: z.array(PublishedPortSchema).default([]),
    volumes: z.array(VolumeNameSchema).default([]),
  })
  .refine(
    (s) => {
      // Roles that do not require an image (built from source)
      if (s.role === 'app' || s.role === 'cron') return true;
      return s.image !== null;
    },
    { message: 'image is required for this role', path: ['image'] }
  );

export const ComposeVolumeSchema = z.strictObject({
  name: VolumeNameSchema,
  content: z.enum(['db', 'storage']),
  inBackup: z.boolean(),
});

export type ComposeService = z.infer<typeof ComposeServiceSchema>;
export type ComposeVolume = z.infer<typeof ComposeVolumeSchema>;

// ---------------------------------------------------------------------------
// Topology schema
// ---------------------------------------------------------------------------

export type ComposeTopology = {
  services: ComposeService[];
  volumes: ComposeVolume[];
};
export type ComposeTopologyInput = { services: unknown[]; volumes: unknown[] };

const REQUIRED_SERVICE_NAMES = SERVICE_NAMES.filter(
  (n) => !(OPTIONAL_SERVICE_NAMES as readonly string[]).includes(n)
);

export const ComposeTopologySchema = z
  .strictObject({
    services: z.array(ComposeServiceSchema).min(1),
    volumes: z.array(ComposeVolumeSchema).min(1),
  })
  .superRefine((topology, ctx) => {
    const { services, volumes } = topology;

    // 1. Unique service names
    const serviceNames = services.map((s) => s.name);
    const serviceDups = serviceNames.filter(
      (n, i) => serviceNames.indexOf(n) !== i
    );
    for (const dup of serviceDups) {
      const idx = serviceNames.lastIndexOf(dup);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate service name: ${dup}`,
        path: ['services', idx, 'name'],
      });
    }

    // Unique volume names
    const volumeNames = volumes.map((v) => v.name);
    const volumeDups = volumeNames.filter(
      (n, i) => volumeNames.indexOf(n) !== i
    );
    for (const dup of volumeDups) {
      const idx = volumeNames.lastIndexOf(dup);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate volume name: ${dup}`,
        path: ['volumes', idx, 'name'],
      });
    }

    // 2. All required services present
    for (const required of REQUIRED_SERVICE_NAMES) {
      if (!serviceNames.includes(required)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Required service "${required}" is missing`,
          path: ['services'],
        });
      }
    }

    // 3. Exactly one db role and exactly one cron role
    const dbServices = services.filter((s) => s.role === 'db');
    if (dbServices.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Expected exactly one service with role "db", found ${dbServices.length}`,
        path: ['services'],
      });
    }
    const cronServices = services.filter((s) => s.role === 'cron');
    if (cronServices.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Expected exactly one service with role "cron", found ${cronServices.length}`,
        path: ['services'],
      });
    }

    // 4. All volume references in services are declared in volumes
    for (let si = 0; si < services.length; si++) {
      const svc = services[si]!;
      for (let vi = 0; vi < svc.volumes.length; vi++) {
        const ref = svc.volumes[vi]!;
        if (!volumeNames.includes(ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Service "${svc.name}" references undeclared volume "${ref}"`,
            path: ['services', si, 'volumes', vi],
          });
        }
      }
    }

    // 5. No Postgres ports published (host or container side)
    for (let si = 0; si < services.length; si++) {
      const svc = services[si]!;
      for (let pi = 0; pi < svc.publishedPorts.length; pi++) {
        const port = svc.publishedPorts[pi]!;
        if ((POSTGRES_PORTS as readonly number[]).includes(port.host)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Postgres port ${port.host} must not be published on the host`,
            path: ['services', si, 'publishedPorts', pi, 'host'],
          });
        }
        if ((POSTGRES_PORTS as readonly number[]).includes(port.container)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Postgres port ${port.container} must not be published on the container side`,
            path: ['services', si, 'publishedPorts', pi, 'container'],
          });
        }
      }
    }

    // 6. The db service must not publish any ports
    for (let si = 0; si < services.length; si++) {
      const svc = services[si]!;
      if (svc.role === 'db' && svc.publishedPorts.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'The db service must not publish any ports',
          path: ['services', si, 'publishedPorts'],
        });
      }
    }

    // 7. Exactly one db volume (inBackup: true) and one storage volume (inBackup: true)
    const dbVolumes = volumes.filter((v) => v.content === 'db');
    const storageVolumes = volumes.filter((v) => v.content === 'storage');
    if (dbVolumes.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Expected exactly one volume with content "db", found ${dbVolumes.length}`,
        path: ['volumes'],
      });
    } else if (!dbVolumes[0]!.inBackup) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The db volume must have inBackup: true',
        path: ['volumes', volumes.indexOf(dbVolumes[0]!), 'inBackup'],
      });
    }
    if (storageVolumes.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Expected exactly one volume with content "storage", found ${storageVolumes.length}`,
        path: ['volumes'],
      });
    } else if (!storageVolumes[0]!.inBackup) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The storage volume must have inBackup: true',
        path: ['volumes', volumes.indexOf(storageVolumes[0]!), 'inBackup'],
      });
    }
  }) as z.ZodType<ComposeTopology>;

export function parseTopology(input: unknown): ComposeTopology {
  return (ComposeTopologySchema as z.ZodType<ComposeTopology>).parse(input);
}

// ---------------------------------------------------------------------------
// Consumer helpers
// ---------------------------------------------------------------------------

export function databaseServiceName(topology: ComposeTopology): ServiceName {
  const matches = topology.services.filter((s) => s.role === 'db');
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one service with role "db", found ${matches.length}. Was this topology parsed with parseTopology?`
    );
  }
  return matches[0]!.name;
}

export function cronServiceName(topology: ComposeTopology): ServiceName {
  const matches = topology.services.filter((s) => s.role === 'cron');
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one service with role "cron", found ${matches.length}. Was this topology parsed with parseTopology?`
    );
  }
  return matches[0]!.name;
}

/**
 * Returns the names of volumes that must be backed up, in the order defined by VOLUME_NAMES.
 */
export function backupVolumeNames(topology: ComposeTopology): VolumeName[] {
  const inBackup = new Set(
    topology.volumes.filter((v) => v.inBackup).map((v) => v.name)
  );
  return VOLUME_NAMES.filter((n) => inBackup.has(n));
}

export type NameChanges = {
  addedServices: string[];
  removedServices: string[];
  addedVolumes: string[];
  removedVolumes: string[];
};

/**
 * Compares the current topology's names against a proposed set of raw names.
 * Useful for UPD to detect renames before validating a new compose file.
 */
export function nameChanges(
  current: ComposeTopology,
  proposed: { services: readonly string[]; volumes: readonly string[] }
): NameChanges {
  const currentServices = new Set(
    current.services.map((s) => s.name as string)
  );
  const proposedServices = new Set(proposed.services);
  const currentVolumes = new Set(current.volumes.map((v) => v.name as string));
  const proposedVolumes = new Set(proposed.volumes);

  return {
    addedServices: [...proposedServices]
      .filter((n) => !currentServices.has(n))
      .sort(),
    removedServices: [...currentServices]
      .filter((n) => !proposedServices.has(n))
      .sort(),
    addedVolumes: [...proposedVolumes]
      .filter((n) => !currentVolumes.has(n))
      .sort(),
    removedVolumes: [...currentVolumes]
      .filter((n) => !proposedVolumes.has(n))
      .sort(),
  };
}
