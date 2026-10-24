/**
 * UPD.1 · IT con una plantilla y un hijo reales (repos git temporales, sin red).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RUTAS_EMPRESA } from '@contracts/cfg/tenant-config';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const TSX = join(RAIZ, 'node_modules/.bin/tsx');
const TSCONFIG = join(RAIZ, 'tsconfig.json');
const CLI = join(RAIZ, 'scripts/upd/revisar-cambio.cli.ts');
const SH = join(RAIZ, 'scripts/upd/actualizar-desde-template.sh');

function correrCli(repo: string, ...args: string[]) {
  const r = spawnSync(
    TSX,
    ['--tsconfig', TSCONFIG, CLI, ...args, '--repo', repo],
    { cwd: repo, encoding: 'utf8' },
  );
  return { codigo: r.status, salida: r.stdout + r.stderr };
}

function correrProcedimiento(hijo: string) {
  const r = spawnSync('bash', [SH, 'template/main'], {
    cwd: hijo,
    encoding: 'utf8',
    env: { ...process.env, UPD_FECHA: '2026-01-01' },
  });
  return { codigo: r.status, salida: r.stdout + r.stderr };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function escribir(repo: string, ruta: string, contenido: string) {
  const p = join(repo, ruta);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, contenido);
}

function commit(repo: string, mensaje: string) {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', mensaje);
}

function configurar(repo: string) {
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
}

vi.setConfig({ testTimeout: 60_000 });

const ARCHIVOS_EMPRESA = [...RUTAS_EMPRESA, '.env'];
const sha = (p: string) =>
  createHash('sha256').update(readFileSync(p)).digest('hex');

describe('UPD.1 · merge de la plantilla en un hijo', () => {
  let tmp: string;
  let plantilla: string;
  let hijo: string;
  let antes: Record<string, string>;

  const hashes = () =>
    Object.fromEntries(ARCHIVOS_EMPRESA.map((r) => [r, sha(join(hijo, r))]));

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'upd-'));
    plantilla = join(tmp, 'plantilla');
    hijo = join(tmp, 'hijo');
    mkdirSync(plantilla);
    git(plantilla, 'init', '-q', '-b', 'main');
    configurar(plantilla);
    escribir(plantilla, 'src/a.ts', 'export const a = 1;\n');
    escribir(plantilla, '.env.example', 'FOO=1\n');
    copyFileSync(join(RAIZ, '.gitignore'), join(plantilla, '.gitignore'));
    copyFileSync(
      join(RAIZ, 'docker-compose.yml'),
      join(plantilla, 'docker-compose.yml'),
    );
    commit(plantilla, 'inicial');

    git(tmp, 'clone', '-q', plantilla, hijo);
    git(hijo, 'remote', 'rename', 'origin', 'template');
    configurar(hijo);
    for (const r of RUTAS_EMPRESA) escribir(hijo, r, 'empresa: acme\n');
    commit(hijo, 'empresa');
    escribir(hijo, '.env', 'ENCRYPTION_KEY=secreto\n'); // ignorado por .gitignore
    antes = hashes();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('rechazo: el chequeo de la plantilla rechaza un cambio que toca una ruta de la empresa', () => {
    git(plantilla, 'switch', '-q', '-c', 'feat/x');
    escribir(plantilla, 'config/policies.yaml', 'plantilla: true\n');
    commit(plantilla, 'toca config');
    const r = correrCli(plantilla, '--rango', 'main...feat/x');
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('config/policies.yaml');
    expect(r.salida).toContain('RECHAZADO');
  });

  it('merge limpio: trae el cambio del template y no modifica los archivos de la empresa', () => {
    escribir(plantilla, 'src/a.ts', 'export const a = 2;\n');
    escribir(plantilla, '.env.example', 'FOO=2\n');
    commit(plantilla, 'cambio del template');
    const cabeza = git(hijo, 'rev-parse', 'HEAD');

    const r = correrProcedimiento(hijo);
    expect(r.codigo, r.salida).toBe(0);
    expect(
      git(hijo, 'diff', '--cached', '--name-only', 'HEAD').trim().split('\n'),
    ).toEqual(['.env.example', 'src/a.ts']);
    expect(hashes()).toEqual(antes);
    expect(git(hijo, 'rev-parse', 'HEAD')).toBe(cabeza);
  });

  it('merge abortado: un cambio de la plantilla en config/ no llega al hijo', () => {
    escribir(plantilla, 'config/modules.yaml', 'plantilla: true\n');
    commit(plantilla, 'toca config');
    const rama = git(hijo, 'symbolic-ref', '--short', 'HEAD').trim();

    const r = correrProcedimiento(hijo);
    expect(r.codigo, r.salida).toBe(1);
    expect(git(hijo, 'status', '--porcelain').trim()).toBe('');
    expect(git(hijo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe(rama);
    expect(git(hijo, 'branch', '--list', 'upd/2026-01-01').trim()).toBe('');
    expect(hashes()).toEqual(antes);
  });

  it('conflicto en ruta de la empresa: aborta', () => {
    git(plantilla, 'switch', '-q', 'main');
    escribir(plantilla, 'config/policies.yaml', 'plantilla: true\n');
    commit(plantilla, 'plantilla toca policies');

    const r = correrProcedimiento(hijo);
    expect(r.codigo, r.salida).toBe(1);
    expect(git(hijo, 'status', '--porcelain').trim()).toBe('');
    expect(hashes()).toEqual(antes);
  });

  it('la plantilla trae un .env versionado: rechaza sin tocar el .env del hijo', () => {
    git(plantilla, 'switch', '-q', 'main');
    escribir(plantilla, '.env', 'ENCRYPTION_KEY=de-la-plantilla\n');
    git(plantilla, 'add', '-f', '.env');
    git(plantilla, 'commit', '-q', '-m', 'versiona .env');
    const rama = git(hijo, 'symbolic-ref', '--short', 'HEAD').trim();

    const r = correrProcedimiento(hijo);
    expect(r.codigo, r.salida).toBe(1);
    expect(readFileSync(join(hijo, '.env'), 'utf8')).toBe(
      'ENCRYPTION_KEY=secreto\n',
    );
    expect(hashes()).toEqual(antes);
    expect(git(hijo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe(rama);
    expect(git(hijo, 'branch', '--list', 'upd/2026-01-01').trim()).toBe('');
  });

  it('historias sin relación: sale con 3 y no deja rama ni cambios', () => {
    const otro = join(tmp, 'otro');
    mkdirSync(otro);
    git(otro, 'init', '-q', '-b', 'main');
    configurar(otro);
    escribir(otro, 'src/b.ts', 'export const b = 1;\n');
    commit(otro, 'raíz distinta');
    git(hijo, 'remote', 'set-url', 'template', otro);

    const r = correrProcedimiento(hijo);
    expect(r.codigo, r.salida).toBe(3);
    expect(r.salida).toContain('no comparte historia');
    expect(git(hijo, 'status', '--porcelain').trim()).toBe('');
    expect(git(hijo, 'branch', '--list', 'upd/2026-01-01').trim()).toBe('');
    expect(hashes()).toEqual(antes);
  });

  it('árbol sucio: se niega a arrancar', () => {
    escribir(hijo, 'src/local.ts', 'x\n');
    const r = correrProcedimiento(hijo);
    expect(r.codigo).toBe(3);
    expect(git(hijo, 'status', '--porcelain').trim()).toBe('?? src/local.ts');
    expect(hashes()).toEqual(antes);
  });
});
