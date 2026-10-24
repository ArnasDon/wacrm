/**
 * UPD.1 · Arma la entrada del núcleo desde git: un rango `base...head` o un
 * merge preparado (índice contra HEAD). Siempre execFileSync, nunca un string.
 */

import { execFileSync } from 'node:child_process';
import * as yaml from 'js-yaml';

import { parseTopology } from '@contracts/base/compose-services';
import { toTopologyInput } from '../compose/topology';
import {
  parsearNameStatus,
  type CambioArchivo,
  type ComposeAntesDespues,
} from './revisar-cambio';

export type Origen = { tipo: 'rango'; rango: string } | { tipo: 'merge' };

const COMPOSE = 'docker-compose.yml';
const ENV_EJEMPLO = '.env.example';

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitOpcional(repo: string, args: string[]): string | undefined {
  try {
    return git(repo, args);
  } catch {
    return undefined;
  }
}

export function cambiosDesdeGit(repo: string, origen: Origen): CambioArchivo[] {
  if (origen.tipo === 'rango') {
    return parsearNameStatus(
      git(repo, ['diff', '--name-status', '-z', '--find-renames', origen.rango]),
    );
  }
  const cambios = parsearNameStatus(
    git(repo, [
      'diff',
      '--cached',
      '--name-status',
      '-z',
      '--find-renames',
      'HEAD',
    ]),
  );
  const sinResolver = new Set(
    git(repo, ['diff', '--name-only', '-z', '--diff-filter=U'])
      .split('\0')
      .filter((r) => r !== ''),
  );
  const conocidas = new Set(cambios.map((c) => c.ruta));
  const resultado = cambios.map((c) =>
    sinResolver.has(c.ruta) ? { ...c, estado: 'U' as const } : c,
  );
  for (const ruta of sinResolver) {
    if (!conocidas.has(ruta)) resultado.push({ estado: 'U', ruta });
  }
  return resultado;
}

export function parsearEnvEjemplo(texto: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const linea of texto.split(/\r?\n/)) {
    const l = linea.trim();
    if (l === '' || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i <= 0) continue;
    const clave = l.slice(0, i).trim();
    let valor = l.slice(i + 1).trim();
    if (
      valor.length >= 2 &&
      (valor[0] === '"' || valor[0] === "'") &&
      valor.at(-1) === valor[0]
    ) {
      valor = valor.slice(1, -1);
    }
    env[clave] = valor;
  }
  return env;
}

type Lados = { antes: string; despues: (ruta: string) => string | undefined };

function lados(repo: string, origen: Origen): Lados {
  if (origen.tipo === 'rango') {
    const [base, head] = origen.rango.split('...') as [string, string];
    const mb = git(repo, ['merge-base', base, head]).trim();
    return {
      antes: mb,
      despues: (ruta) => gitOpcional(repo, ['show', `${head}:${ruta}`]),
    };
  }
  return {
    antes: 'HEAD',
    despues: (ruta) =>
      gitOpcional(repo, ['show', `:${ruta}`]) ??
      gitOpcional(repo, ['show', `:3:${ruta}`]),
  };
}

export function composeDesdeGit(
  repo: string,
  origen: Origen,
): ComposeAntesDespues | undefined {
  const cambios = cambiosDesdeGit(repo, origen);
  if (!cambios.some((c) => c.ruta === COMPOSE || c.rutaOrigen === COMPOSE)) return undefined;
  const l = lados(repo, origen);
  const textoAntes = gitOpcional(repo, ['show', `${l.antes}:${COMPOSE}`]);
  if (textoAntes === undefined) return undefined; // compose nuevo: no hay topología previa
  const envAntes = parsearEnvEjemplo(
    gitOpcional(repo, ['show', `${l.antes}:${ENV_EJEMPLO}`]) ?? '',
  );
  const actual = parseTopology(toTopologyInput(yaml.load(textoAntes), envAntes));
  const textoDespues = l.despues(COMPOSE);
  const propuesto = textoDespues === undefined ? {} : yaml.load(textoDespues);
  const env = parsearEnvEjemplo(l.despues(ENV_EJEMPLO) ?? '');
  return { actual, propuesto, env };
}
