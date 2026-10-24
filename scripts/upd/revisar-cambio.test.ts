import { describe, expect, it } from 'vitest';
import { stubRutasEmpresa } from '@contracts/cfg/tenant-config.stub';
import { BASE_TOPOLOGY, BASE_TOPOLOGY_INPUT } from '@contracts/base/compose-services.stub';
import type { ComposeTopologyInput } from '@contracts/base/compose-services';
import { formatearReporte, parsearNameStatus, revisarCambio, type CambioArchivo } from './revisar-cambio';

type DocCompose = {
  services: Record<string, Record<string, unknown>>;
  volumes: Record<string, Record<string, never>>;
};
type ServicioStub = {
  name: string;
  image: string | null;
  publishedPorts: { host: number; container: number }[];
  volumes: string[];
};
const HEALTHCHECK = { test: ['CMD', 'true'] };

function documentoDesde(input: ComposeTopologyInput): DocCompose {
  const services: DocCompose['services'] = {};
  for (const s of input.services as ServicioStub[]) {
    services[s.name] = {
      ...(s.image === null ? { build: '.' } : { image: s.image }),
      healthcheck: HEALTHCHECK,
      ports: s.publishedPorts.map((p) => `${p.host}:${p.container}`),
      volumes: s.volumes.map((v) => `${v}:/data/${v}`),
    };
  }
  const volumes: DocCompose['volumes'] = {};
  for (const v of input.volumes as { name: string }[]) volumes[v.name] = {};
  return { services, volumes };
}

// Renombra la clave en `volumes` y cada montaje `de:/…` de los servicios.
function renombrarVolumen(doc: DocCompose, de: string, a: string): DocCompose {
  const volumes = Object.fromEntries(
    Object.entries(doc.volumes).map(([k, v]) => [k === de ? a : k, v]),
  );
  const services = Object.fromEntries(
    Object.entries(doc.services).map(([n, s]) => [
      n,
      {
        ...s,
        volumes: ((s.volumes as string[]) ?? []).map((mnt) =>
          mnt.startsWith(`${de}:`) ? `${a}${mnt.slice(de.length)}` : mnt,
        ),
      },
    ]),
  );
  return { services, volumes };
}

function quitarServicio(doc: DocCompose, nombre: string): DocCompose {
  return {
    ...doc,
    services: Object.fromEntries(Object.entries(doc.services).filter(([n]) => n !== nombre)),
  };
}

function agregarServicio(doc: DocCompose, nombre: string, imagen: string): DocCompose {
  return {
    ...doc,
    services: {
      ...doc.services,
      [nombre]: { image: imagen, healthcheck: HEALTHCHECK, ports: [], volumes: [] },
    },
  };
}

const m = (ruta: string): CambioArchivo => ({ estado: 'M', ruta });

describe('parsearNameStatus', () => {
  it('lee salida -z con renombres y rutas con espacios y tildes', () => {
    const z = 'M\0src/a.ts\0R100\0config/policies.yaml\0config/políticas nuevas.yaml\0A\0docs/x.md\0';
    expect(parsearNameStatus(z)).toEqual([
      { estado: 'M', ruta: 'src/a.ts' },
      { estado: 'R', rutaOrigen: 'config/policies.yaml', ruta: 'config/políticas nuevas.yaml' },
      { estado: 'A', ruta: 'docs/x.md' },
    ]);
  });
  it('devuelve [] para salida vacía', () => {
    expect(parsearNameStatus('')).toEqual([]);
  });
});

describe('revisarCambio · rutas de la empresa (CT.1)', () => {
  it('rechaza un cambio que toca una ruta de la empresa', () => {
    const v = revisarCambio([m('src/app/page.tsx'), m('config/policies.yaml')]);
    expect(v.ok).toBe(false);
    expect(v.rutasEmpresa).toEqual(['config/policies.yaml']);
  });
  it('rechaza toda ruta que el stub de CT.1 declara de la empresa', () => {
    const v = revisarCambio(stubRutasEmpresa().map(m));
    expect(v.rutasEmpresa).toEqual([...stubRutasEmpresa()].sort());
  });
  it('deja pasar los ejemplos del template y el código', () => {
    const v = revisarCambio(['.env.example', '.env.local.example', 'src/lib/x.ts', 'supabase/migrations/0002.sql'].map(m));
    expect(v).toEqual({ ok: true, rutasEmpresa: [], compose: null });
  });
  it('renombre: bloquea si el origen o el destino es de la empresa', () => {
    expect(revisarCambio([{ estado: 'R', rutaOrigen: 'config/modules.yaml', ruta: 'src/m.yaml' }]).ok).toBe(false);
    expect(revisarCambio([{ estado: 'R', rutaOrigen: 'src/m.yaml', ruta: 'config/modules.yaml' }]).ok).toBe(false);
  });
  it('bloquea un borrado o un conflicto en ruta de la empresa', () => {
    expect(revisarCambio([{ estado: 'D', ruta: '.env' }]).ok).toBe(false);
    expect(revisarCambio([{ estado: 'U', ruta: 'config/policies.yaml' }]).ok).toBe(false);
  });
});

describe('revisarCambio · compose (CT.2)', () => {
  const compose = (propuesto: unknown) => ({ actual: BASE_TOPOLOGY, propuesto, env: {} });

  it('un compose igual al stub pasa y no informa cambios', () => {
    const v = revisarCambio([m('docker-compose.yml')], compose(documentoDesde(BASE_TOPOLOGY_INPUT)));
    expect(v.ok).toBe(true);
    expect(v.compose?.bloqueos).toEqual([]);
  });
  it('volumen renombrado: bloquea', () => {
    const v = revisarCambio([m('docker-compose.yml')], compose(renombrarVolumen(documentoDesde(BASE_TOPOLOGY_INPUT), 'supabase-storage-data', 'storage-data')));
    expect(v.ok).toBe(false);
    expect(v.compose?.cambios.removedVolumes).toEqual(['supabase-storage-data']);
  });
  it('servicio obligatorio quitado: bloquea', () => {
    const v = revisarCambio([m('docker-compose.yml')], compose(quitarServicio(documentoDesde(BASE_TOPOLOGY_INPUT), 'supabase-storage')));
    expect(v.ok).toBe(false);
  });
  it('servicio opcional agregado: pasa e informa', () => {
    // BASE_TOPOLOGY no trae `tunnel` (opcional); el propuesto lo agrega.
    const v = revisarCambio([m('docker-compose.yml')], compose(agregarServicio(documentoDesde(BASE_TOPOLOGY_INPUT), 'tunnel', 'cloudflare/cloudflared:2024.12.2')));
    expect(v.ok).toBe(true);
    expect(v.compose?.cambios.addedServices).toEqual(['tunnel']);
    expect(v.compose?.bloqueos).toEqual([]);
  });
  it('sin docker-compose.yml en el cambio, ignora el argumento compose', () => {
    expect(revisarCambio([m('src/a.ts')], compose({})).compose).toBeNull();
  });
});

describe('formatearReporte', () => {
  it('nombra cada ruta bloqueada y dice RECHAZADO', () => {
    const txt = formatearReporte(revisarCambio([m('config/policies.yaml')]));
    expect(txt).toContain('RECHAZADO');
    expect(txt).toContain('config/policies.yaml');
  });
  it('dice OK cuando pasa', () => {
    expect(formatearReporte(revisarCambio([m('src/a.ts')]))).toContain('OK');
  });
});
