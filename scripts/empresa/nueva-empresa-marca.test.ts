import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LOGO_MAX_BYTES,
  TIPOS_LOGO,
  leerMarca,
} from '../../src/lib/marca/marca';
import { RAIZ_TEMPLATE } from './repo-hijo';

const CLI = join(RAIZ_TEMPLATE, 'scripts', 'empresa', 'nueva-empresa.mjs');

const limpiables: Array<() => void> = [];
afterEach(() => {
  while (limpiables.length > 0) limpiables.pop()!();
});

function tmp(prefijo: string): string {
  const d = mkdtempSync(join(tmpdir(), prefijo));
  limpiables.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

/** Copia vacía con solo .env.example y config.ejemplo/. */
function dirMinimo(): string {
  const dir = tmp('hijo-marca-');
  copyFileSync(join(RAIZ_TEMPLATE, '.env.example'), join(dir, '.env.example'));
  mkdirSync(join(dir, 'config.ejemplo'));
  for (const f of ['empresa.yaml', 'modules.yaml', 'policies.yaml'])
    copyFileSync(
      join(RAIZ_TEMPLATE, 'config.ejemplo', f),
      join(dir, 'config.ejemplo', f)
    );
  return dir;
}

function archivoLogo(nombre: string, bytes = 100): string {
  const ruta = join(tmp('logo-'), nombre);
  writeFileSync(ruta, Buffer.alloc(bytes, 1));
  return ruta;
}

function correr(dir: string, extra: string[]) {
  return spawnSync(
    process.execPath,
    [CLI, '--dir', dir, '--id', 'baru', '--nombre', 'Barú', ...extra],
    { encoding: 'utf8' }
  );
}

describe('nueva-empresa --logo / --color', () => {
  it('copia el logo y escribe config/marca.yaml legible por leerMarca', () => {
    const dir = dirMinimo();
    const r = correr(dir, [
      '--logo',
      archivoLogo('mi-logo.PNG'),
      '--color',
      '#e11d48',
    ]);
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, 'config/marca/logo.png'))).toBe(true);
    const m = leerMarca(join(dir, 'config'));
    expect(m.color).toBe('#e11d48');
    expect(m.logoPropio).toBe(true);
    expect(m.nombre).toBe('Barú');
  });

  it('solo --color: sin carpeta de logo', () => {
    const dir = dirMinimo();
    expect(correr(dir, ['--color', '#0ea5e9']).status).toBe(0);
    expect(existsSync(join(dir, 'config/marca'))).toBe(false);
    expect(leerMarca(join(dir, 'config')).color).toBe('#0ea5e9');
  });

  it('sin flags no crea marca.yaml', () => {
    const dir = dirMinimo();
    expect(correr(dir, []).status).toBe(0);
    expect(existsSync(join(dir, 'config/marca.yaml'))).toBe(false);
  });

  it.each([
    ['color inválido', () => ['--color', 'red']],
    ['color sin #', () => ['--color', 'e11d48']],
    ['logo inexistente', () => ['--logo', '/no/existe.png']],
    ['extensión no permitida', () => ['--logo', archivoLogo('logo.gif')]],
    [
      'logo de más de 1 MB',
      () => ['--logo', archivoLogo('logo.png', LOGO_MAX_BYTES + 1)],
    ],
  ])('%s → error y no escribe nada', (_n, flags) => {
    const dir = dirMinimo();
    const r = correr(dir, flags());
    expect(r.status).toBe(1);
    expect(existsSync(join(dir, '.env'))).toBe(false);
    expect(existsSync(join(dir, 'config'))).toBe(false);
  });

  it('usa las mismas extensiones y límite que src/lib/marca', () => {
    const fuente = readFileSync(CLI, 'utf8');
    for (const ext of Object.keys(TIPOS_LOGO))
      expect(fuente).toContain(`'${ext}'`);
    expect(fuente).toContain(`${LOGO_MAX_BYTES / 1024 / 1024} * 1024 * 1024`);
    expect(fuente).toContain('/^#[0-9a-fA-F]{6}$/');
  });
});
