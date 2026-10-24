import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  EJEMPLOS_TEMPLATE,
  PREFIJOS_EMPRESA,
  RUTAS_EMPRESA,
  VARS_EMPRESA,
} from '../../contracts/cfg/tenant-config';
import { cargarConfigEmpresa } from './config-empresa';
import { crearRepoHijo, RAIZ_TEMPLATE, type RepoHijo } from './repo-hijo';

const CLI = join(RAIZ_TEMPLATE, 'scripts', 'empresa', 'nueva-empresa.mjs');

const limpiables: Array<() => void> = [];
afterEach(() => {
  while (limpiables.length > 0) limpiables.pop()!();
});

function hijoDe(id: string, nombre: string): RepoHijo {
  const h = crearRepoHijo({ id, nombre });
  limpiables.push(h.limpiar);
  return h;
}

/** Copia vacía con solo .env.example y config.ejemplo/. */
function dirMinimo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hijo-min-'));
  limpiables.push(() => rmSync(dir, { recursive: true, force: true }));
  copyFileSync(join(RAIZ_TEMPLATE, '.env.example'), join(dir, '.env.example'));
  mkdirSync(join(dir, 'config.ejemplo'));
  for (const f of ['empresa.yaml', 'modules.yaml', 'policies.yaml'])
    copyFileSync(
      join(RAIZ_TEMPLATE, 'config.ejemplo', f),
      join(dir, 'config.ejemplo', f)
    );
  return dir;
}

describe('nueva-empresa', () => {
  it('crea config/ y un .env propio en el hijo', () => {
    const hijo = hijoDe('baru', 'Grifería "Barú": Cartagena');
    for (const r of [
      'config/empresa.yaml',
      'config/modules.yaml',
      'config/policies.yaml',
      '.env',
    ])
      expect(existsSync(join(hijo.dir, r))).toBe(true);
    expect(hijo.env.COMPOSE_PROJECT_NAME).toBe('wacrm-baru');
    expect(hijo.env.ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    const llave = Buffer.from(hijo.env.ENCRYPTION_KEY, 'hex');
    const iv = randomBytes(12);
    const cif = createCipheriv('aes-256-gcm', llave, iv);
    const ct = Buffer.concat([cif.update('token', 'utf8'), cif.final()]);
    const dec = createDecipheriv('aes-256-gcm', llave, iv);
    dec.setAuthTag(cif.getAuthTag());
    expect(
      Buffer.concat([dec.update(ct), dec.final()]).toString('utf8')
    ).toBe('token');
    expect(hijo.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe(hijo.env.ANON_KEY);
    expect(hijo.env.SUPABASE_SERVICE_ROLE_KEY).toBe(hijo.env.SERVICE_ROLE_KEY);
    expect(cargarConfigEmpresa(hijo.dir, hijo.env).empresa).toEqual({
      id: 'baru',
      nombre: 'Grifería "Barú": Cartagena',
    });
  });

  it('genera llaves distintas para dos empresas', () => {
    const a = hijoDe('a', 'A');
    const b = hijoDe('b', 'B');
    expect(a.env.ENCRYPTION_KEY).not.toBe(b.env.ENCRYPTION_KEY);
    expect(a.env.COMPOSE_PROJECT_NAME).not.toBe(b.env.COMPOSE_PROJECT_NAME);
  });

  it('se niega a correr dos veces y no toca el .env ni config/ existentes (R7)', () => {
    const hijo = hijoDe('baru', 'Barú');
    const antes = readFileSync(join(hijo.dir, '.env'), 'utf8');
    const r = spawnSync(process.execPath, [
      CLI,
      '--dir',
      hijo.dir,
      '--id',
      'baru',
      '--nombre',
      'Barú',
    ]);
    expect(r.status).toBe(1);
    expect(readFileSync(join(hijo.dir, '.env'), 'utf8')).toBe(antes);
  });

  it.each(['Baru', 'mi empresa', '1empresa', ''])(
    'rechaza el id %j sin escribir nada',
    (id) => {
      const dir = dirMinimo();
      const r = spawnSync(process.execPath, [
        CLI,
        '--dir',
        dir,
        '--id',
        id,
        '--nombre',
        'X',
      ]);
      expect(r.status).toBe(1);
      expect(existsSync(join(dir, '.env'))).toBe(false);
      expect(existsSync(join(dir, 'config'))).toBe(false);
    }
  );

  it('usa la misma expresión de identificador que el contrato', () => {
    const fuente = readFileSync(CLI, 'utf8');
    expect(fuente).toContain('/^[a-z][a-z0-9-]*$/');
    const contrato = readFileSync(
      join(RAIZ_TEMPLATE, 'contracts/cfg/tenant-config.ts'),
      'utf8'
    );
    expect(contrato).toContain('/^[a-z][a-z0-9-]*$/');
  });

  it('docs/repo-hijo.md nombra todas las rutas y variables de la empresa del contrato', () => {
    const doc = readFileSync(join(RAIZ_TEMPLATE, 'docs/repo-hijo.md'), 'utf8');
    for (const n of [
      ...RUTAS_EMPRESA,
      ...PREFIJOS_EMPRESA,
      ...EJEMPLOS_TEMPLATE,
      ...VARS_EMPRESA,
      'config/empresa.yaml',
      'COMPOSE_PROJECT_NAME',
    ])
      expect(doc).toContain(`\`${n}\``);
  });
});
