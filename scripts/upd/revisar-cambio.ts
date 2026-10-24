/**
 * UPD.1 · Núcleo puro del chequeo de actualización. Sin git ni fs.
 * Clasifica rutas con CT.1 (`esRutaDeEmpresa`) y valida el compose con CT.2.
 */

import { esRutaDeEmpresa } from '@contracts/cfg/tenant-config';
import {
  OPTIONAL_SERVICE_NAMES,
  nameChanges,
  parseTopology,
  type ComposeTopology,
  type NameChanges,
} from '@contracts/base/compose-services';
import { toTopologyInput } from '../compose/topology';

export type EstadoCambio = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U';
export type CambioArchivo = {
  estado: EstadoCambio;
  ruta: string;
  rutaOrigen?: string;
};
export type ComposeAntesDespues = {
  actual: ComposeTopology;
  propuesto: unknown;
  env: Record<string, string>;
};
export type Veredicto = {
  ok: boolean;
  rutasEmpresa: string[];
  compose: { cambios: NameChanges; bloqueos: string[] } | null;
};

/** Parsea la salida de `git diff --name-status -z`. */
export function parsearNameStatus(salidaZ: string): CambioArchivo[] {
  const tokens = salidaZ.split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const cambios: CambioArchivo[] = [];
  for (let i = 0; i < tokens.length; ) {
    const estado = tokens[i]![0] as EstadoCambio;
    if (estado === 'R' || estado === 'C') {
      cambios.push({ estado, rutaOrigen: tokens[i + 1]!, ruta: tokens[i + 2]! });
      i += 3;
    } else {
      cambios.push({ estado, ruta: tokens[i + 1]! });
      i += 2;
    }
  }
  return cambios;
}

function revisarCompose(c: ComposeAntesDespues): {
  cambios: NameChanges;
  bloqueos: string[];
} {
  const doc = (c.propuesto ?? {}) as {
    services?: Record<string, unknown> | null;
    volumes?: Record<string, unknown> | null;
  };
  // 1. Nombres crudos, siempre (no dependen de que el documento sea válido).
  const cambios = nameChanges(c.actual, {
    services: Object.keys(doc.services ?? {}),
    volumes: Object.keys(doc.volumes ?? {}),
  });
  const bloqueos: string[] = [];
  // 2. Validación contra CT.2; si lanza, un bloqueo y se sigue.
  try {
    parseTopology(
      toTopologyInput({ ...doc, services: doc.services ?? {} }, c.env),
    );
  } catch (e) {
    bloqueos.push(
      `docker-compose.yml no pasa CT.2: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // 3. Quitas que bloquean (un renombre es quitar + agregar).
  for (const s of cambios.removedServices) {
    if (!(OPTIONAL_SERVICE_NAMES as readonly string[]).includes(s)) {
      bloqueos.push(`quita o renombra el servicio obligatorio "${s}"`);
    }
  }
  for (const v of cambios.removedVolumes) {
    bloqueos.push(`quita o renombra el volumen "${v}"`);
  }
  return { cambios, bloqueos };
}

export function revisarCambio(
  cambios: readonly CambioArchivo[],
  compose?: ComposeAntesDespues,
): Veredicto {
  const bloqueadas = new Set<string>();
  for (const c of cambios) {
    if (c.rutaOrigen !== undefined && esRutaDeEmpresa(c.rutaOrigen)) {
      bloqueadas.add(c.rutaOrigen);
    }
    if (esRutaDeEmpresa(c.ruta)) bloqueadas.add(c.ruta);
  }
  const rutasEmpresa = [...bloqueadas].sort();
  const tocaCompose = cambios.some(
    (c) => c.ruta === 'docker-compose.yml' || c.rutaOrigen === 'docker-compose.yml',
  );
  const revCompose = tocaCompose && compose ? revisarCompose(compose) : null;
  return {
    ok: rutasEmpresa.length === 0 && (revCompose?.bloqueos.length ?? 0) === 0,
    rutasEmpresa,
    compose: revCompose,
  };
}

export function formatearReporte(v: Veredicto): string {
  const lineas = [
    `UPD · chequeo de actualización: ${v.ok ? 'OK' : 'RECHAZADO'}`,
  ];
  if (v.rutasEmpresa.length > 0) {
    lineas.push(
      'El cambio toca rutas de la empresa (R5: la plantilla no puede modificarlas):',
    );
    for (const r of v.rutasEmpresa) lineas.push(`  - ${r}`);
  }
  if (v.compose) {
    for (const b of v.compose.bloqueos) lineas.push(`  - ${b}`);
    const c = v.compose.cambios;
    if (c.addedServices.length > 0)
      lineas.push(`Servicios agregados: ${c.addedServices.join(', ')}`);
    if (c.removedServices.length > 0)
      lineas.push(`Servicios quitados: ${c.removedServices.join(', ')}`);
    if (c.addedVolumes.length > 0)
      lineas.push(`Volúmenes agregados: ${c.addedVolumes.join(', ')}`);
    if (c.removedVolumes.length > 0)
      lineas.push(`Volúmenes quitados: ${c.removedVolumes.join(', ')}`);
  }
  return lineas.join('\n');
}
