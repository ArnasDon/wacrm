import { describe, expect, it } from 'vitest';
import {
  ComposeServiceSchema,
  ComposeTopologySchema,
  ComposeVolumeSchema,
  ImageRefSchema,
  OPTIONAL_SERVICE_NAMES,
  POSTGRES_PORTS,
  SERVICE_NAMES,
  VOLUME_NAMES,
  parseTopology,
} from '@contracts/base/compose-services';
import {
  BASE_TOPOLOGY,
  BASE_TOPOLOGY_INPUT,
  createTopologyStub,
} from '@contracts/base/compose-services.stub';

// ---------------------------------------------------------------------------
// Canonical names
// ---------------------------------------------------------------------------

describe('canonical names', () => {
  it('pins the service names of interface I2', () => {
    expect(SERVICE_NAMES).toEqual([
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
    ]);
  });

  it('pins the volume names of interface I2', () => {
    expect(VOLUME_NAMES).toEqual(['supabase-db-data', 'supabase-storage-data']);
  });

  it('marks only studio and the tunnel as optional', () => {
    expect(OPTIONAL_SERVICE_NAMES).toEqual(['supabase-studio', 'tunnel']);
    for (const name of OPTIONAL_SERVICE_NAMES)
      expect(SERVICE_NAMES).toContain(name);
  });

  it('pins the Postgres ports that must never be published', () => {
    expect(POSTGRES_PORTS).toEqual([5432, 6543]);
  });
});

// ---------------------------------------------------------------------------
// ImageRefSchema
// ---------------------------------------------------------------------------

const dbService = {
  name: 'supabase-db',
  role: 'db',
  image: 'supabase/postgres:15.8.1.060',
  healthcheck: true as const,
  publishedPorts: [],
  volumes: ['supabase-db-data'] as ['supabase-db-data'],
};

describe('ImageRefSchema', () => {
  it.each([
    'supabase/postgres:15.8.1.060',
    'kong:2.8.1',
    'ghcr.io/org/app:v1.2.3',
  ])('accepts the pinned tag %s', (image) => {
    expect(ImageRefSchema.parse(image)).toBe(image);
  });

  it.each(['supabase/postgres', 'ghcr.io/org/app', 'kong:latest', 'kong:', ''])(
    'rejects %s',
    (image) => {
      expect(ImageRefSchema.safeParse(image).success).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// ComposeServiceSchema
// ---------------------------------------------------------------------------

describe('ComposeServiceSchema', () => {
  it('accepts a pinned service with a healthcheck', () => {
    expect(ComposeServiceSchema.parse(dbService)).toEqual(dbService);
  });

  it('defaults publishedPorts and volumes to empty', () => {
    const service = ComposeServiceSchema.parse({
      name: 'supabase-meta',
      role: 'aux',
      image: 'supabase/postgres-meta:v0.87.1',
      healthcheck: true,
    });
    expect(service.publishedPorts).toEqual([]);
    expect(service.volumes).toEqual([]);
  });

  it('requires a healthcheck', () => {
    expect(
      ComposeServiceSchema.safeParse({ ...dbService, healthcheck: false })
        .success
    ).toBe(false);
  });

  it('rejects an unknown service name', () => {
    expect(
      ComposeServiceSchema.safeParse({ ...dbService, name: 'db' }).success
    ).toBe(false);
  });

  it('rejects an unknown field', () => {
    expect(
      ComposeServiceSchema.safeParse({ ...dbService, depends_on: ['x'] })
        .success
    ).toBe(false);
  });

  it.each(['app', 'cron'])('allows a null image for the %s role', (role) => {
    const service = {
      ...dbService,
      name: role,
      role,
      image: null,
      volumes: [],
    };
    expect(ComposeServiceSchema.parse(service).image).toBeNull();
  });

  it.each(['db', 'gateway', 'storage', 'tunnel', 'aux'])(
    'requires an image for the %s role',
    (role) => {
      expect(
        ComposeServiceSchema.safeParse({ ...dbService, role, image: null })
          .success
      ).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// ComposeVolumeSchema
// ---------------------------------------------------------------------------

describe('ComposeVolumeSchema', () => {
  it('accepts a backed-up volume', () => {
    const volume = { name: 'supabase-db-data', content: 'db', inBackup: true };
    expect(ComposeVolumeSchema.parse(volume)).toEqual(volume);
  });

  it('rejects an unknown volume name', () => {
    expect(
      ComposeVolumeSchema.safeParse({
        name: 'pgdata',
        content: 'db',
        inBackup: true,
      }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ComposeTopologySchema
// ---------------------------------------------------------------------------

describe('ComposeTopologySchema', () => {
  it('accepts the canonical phase-1 topology', () => {
    expect(() => parseTopology(BASE_TOPOLOGY_INPUT)).not.toThrow();
  });

  it('accepts the topology with the optional services', () => {
    const input = structuredClone(BASE_TOPOLOGY_INPUT);
    input.services.push(
      {
        name: 'supabase-studio',
        role: 'aux',
        image: 'supabase/studio:20240101-0000000',
        healthcheck: true,
        publishedPorts: [],
        volumes: [],
      },
      {
        name: 'tunnel',
        role: 'tunnel',
        image: 'cloudflare/cloudflared:2024.1.1',
        healthcheck: true,
        publishedPorts: [],
        volumes: [],
      }
    );
    expect(() => parseTopology(input)).not.toThrow();
  });

  it.each(['supabase-db', 'supabase-kong', 'supabase-storage', 'app', 'cron'])(
    'rejects a topology without the required service %s',
    (name) => {
      const input = structuredClone(BASE_TOPOLOGY_INPUT);
      input.services = input.services.filter(
        (s) => (s as { name: string }).name !== name
      );
      expect(() => parseTopology(input)).toThrow();
    }
  );

  it('rejects duplicate service names', () => {
    const input = structuredClone(BASE_TOPOLOGY_INPUT);
    input.services.push(
      structuredClone(
        input.services.find((s) => (s as { name: string }).name === 'app')!
      )
    );
    expect(() => parseTopology(input)).toThrow();
  });

  it('rejects duplicate volume names', () => {
    const input = structuredClone(BASE_TOPOLOGY_INPUT);
    input.volumes.push(structuredClone(input.volumes[0]!));
    expect(() => parseTopology(input)).toThrow();
  });

  it('rejects a volume referenced by a service but not declared', () => {
    const input = structuredClone(BASE_TOPOLOGY_INPUT);
    // Remove supabase-storage-data from volumes but keep the service reference
    input.volumes = input.volumes.filter(
      (v) => (v as { name: string }).name !== 'supabase-storage-data'
    );
    expect(() => parseTopology(input)).toThrow();
  });

  it('rejects two services with the db role', () => {
    const input = structuredClone(BASE_TOPOLOGY_INPUT);
    const rest = input.services.find(
      (s) => (s as { name: string }).name === 'supabase-rest'
    ) as {
      role: string;
    };
    rest.role = 'db';
    expect(() => parseTopology(input)).toThrow();
  });

  it('rejects a topology without a cron service role', () => {
    const input = structuredClone(BASE_TOPOLOGY_INPUT);
    const cron = input.services.find(
      (s) => (s as { name: string }).name === 'cron'
    ) as {
      role: string;
    };
    cron.role = 'aux';
    expect(() => parseTopology(input)).toThrow();
  });

  it.each([5432, 6543])(
    'rejects the Postgres port %i published on the host side',
    (port) => {
      const input = structuredClone(BASE_TOPOLOGY_INPUT);
      const app = input.services.find(
        (s) => (s as { name: string }).name === 'app'
      ) as {
        publishedPorts: { host: number; container: number }[];
      };
      app.publishedPorts = [{ host: port, container: 3000 }];
      expect(() => parseTopology(input)).toThrow();
    }
  );

  it.each([5432, 6543])(
    'rejects the Postgres port %i on the container side',
    (port) => {
      const input = structuredClone(BASE_TOPOLOGY_INPUT);
      const app = input.services.find(
        (s) => (s as { name: string }).name === 'app'
      ) as {
        publishedPorts: { host: number; container: number }[];
      };
      app.publishedPorts = [{ host: 15432, container: port }];
      expect(() => parseTopology(input)).toThrow();
    }
  );

  it('rejects any published port on the db service', () => {
    const input = structuredClone(BASE_TOPOLOGY_INPUT);
    const db = input.services.find(
      (s) => (s as { name: string }).name === 'supabase-db'
    ) as {
      publishedPorts: { host: number; container: number }[];
    };
    db.publishedPorts = [{ host: 55432, container: 5432 }];
    expect(() => parseTopology(input)).toThrow();
  });

  it('rejects a db volume that is not backed up', () => {
    expect(() =>
      createTopologyStub({
        volumes: [
          { name: 'supabase-db-data', content: 'db', inBackup: false },
          { name: 'supabase-storage-data', content: 'storage', inBackup: true },
        ],
      })
    ).toThrow();
  });

  it('rejects a topology without a storage volume', () => {
    const input = structuredClone(BASE_TOPOLOGY_INPUT);
    input.volumes = input.volumes.filter(
      (v) => (v as { name: string }).name !== 'supabase-storage-data'
    );
    // Also remove the reference from supabase-storage service
    const storage = input.services.find(
      (s) => (s as { name: string }).name === 'supabase-storage'
    ) as { volumes: string[] };
    storage.volumes = [];
    expect(() => parseTopology(input)).toThrow();
  });

  it('names the offending service in the issue path', () => {
    const result = ComposeTopologySchema.safeParse({
      ...BASE_TOPOLOGY_INPUT,
      services: [
        { ...(BASE_TOPOLOGY_INPUT.services[0] as object), name: 'db' },
      ],
    });
    expect(result.success).toBe(false);
    expect(
      (result as { success: false; error: { issues: { path: unknown[] }[] } })
        .error.issues[0]!.path
    ).toEqual(['services', 0, 'name']);
  });
});

// ---------------------------------------------------------------------------
// Stub and consumer helpers
// ---------------------------------------------------------------------------

describe('stub', () => {
  it('is the canonical phase-1 topology, validated by the schema', () => {
    expect(BASE_TOPOLOGY).toEqual(parseTopology(BASE_TOPOLOGY_INPUT));
    expect(BASE_TOPOLOGY.services.map((s) => s.name)).toEqual([
      'supabase-db',
      'supabase-kong',
      'supabase-auth',
      'supabase-rest',
      'supabase-realtime',
      'supabase-storage',
      'supabase-meta',
      'app',
      'cron',
    ]);
    expect(BASE_TOPOLOGY.volumes.map((v) => v.name)).toEqual(VOLUME_NAMES);
  });

  it('validates overrides through the schema', () => {
    expect(() => createTopologyStub({ volumes: [] })).toThrow();
  });

  it('returns an independent topology on every call', () => {
    expect(createTopologyStub()).not.toBe(createTopologyStub());
    expect(createTopologyStub()).toEqual(BASE_TOPOLOGY);
  });
});

import {
  backupVolumeNames,
  cronServiceName,
  databaseServiceName,
  nameChanges,
} from '@contracts/base/compose-services';

describe('consumer helpers', () => {
  it('exposes the db and cron service names', () => {
    expect(databaseServiceName(BASE_TOPOLOGY)).toBe('supabase-db');
    expect(cronServiceName(BASE_TOPOLOGY)).toBe('cron');
  });

  it('lists the volumes a backup must cover, in contract order', () => {
    expect(backupVolumeNames(BASE_TOPOLOGY)).toEqual([
      'supabase-db-data',
      'supabase-storage-data',
    ]);
  });

  it('reports renamed services and volumes against raw names', () => {
    expect(
      nameChanges(BASE_TOPOLOGY, {
        services: [
          'db',
          'supabase-kong',
          'supabase-auth',
          'supabase-rest',
          'supabase-realtime',
          'supabase-storage',
          'supabase-meta',
          'app',
          'cron',
        ],
        volumes: ['supabase-db-data', 'supabase-storage-data'],
      })
    ).toEqual({
      addedServices: ['db'],
      removedServices: ['supabase-db'],
      addedVolumes: [],
      removedVolumes: [],
    });
  });

  it('reports no change when the names match', () => {
    expect(
      nameChanges(BASE_TOPOLOGY, {
        services: BASE_TOPOLOGY.services.map((s) => s.name),
        volumes: BASE_TOPOLOGY.volumes.map((v) => v.name),
      })
    ).toEqual({
      addedServices: [],
      removedServices: [],
      addedVolumes: [],
      removedVolumes: [],
    });
  });
});
