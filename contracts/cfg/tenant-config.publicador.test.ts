// Verificación del publicador de I1. La cierra CFG.1: cada prueba corre contra un repo
// hijo real creado a partir de los archivos versionados del template.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cargarConfigEmpresa } from '../../scripts/empresa/config-empresa';
import {
  archivosDelTemplate,
  crearRepoHijo,
  leerEnv,
  RAIZ_TEMPLATE,
  type RepoHijo,
} from '../../scripts/empresa/repo-hijo';
import {
  esRutaDeEmpresa,
  RUTAS_EMPRESA,
  TenantConfigSchema,
  VARS_EMPRESA,
} from './tenant-config';

describe('verificación del publicador de I1 (CFG.1)', () => {
  let hijo: RepoHijo;

  beforeAll(() => {
    hijo = crearRepoHijo({
      id: 'empresa-publicador',
      nombre: 'Empresa publicador',
    });
  });
  afterAll(() => hijo?.limpiar());

  it('el repo hijo trae todas las RUTAS_EMPRESA del contrato', () => {
    for (const ruta of RUTAS_EMPRESA)
      expect(existsSync(join(hijo.dir, ruta))).toBe(true);
  });

  it('el .env.example del template declara todas las VARS_EMPRESA', () => {
    const declaradas = Object.keys(
      leerEnv(join(RAIZ_TEMPLATE, '.env.example'))
    );
    expect(declaradas).toEqual(expect.arrayContaining([...VARS_EMPRESA]));
  });

  it('config/modules.yaml del repo hijo parsea con TenantConfigSchema', () => {
    const config = cargarConfigEmpresa(hijo.dir, hijo.env);
    expect(() => TenantConfigSchema.parse(config)).not.toThrow();
    expect(config.modulos.asignacion?.activo).toBe(false);
  });

  it('ningún archivo del template cae en esRutaDeEmpresa', () => {
    expect(archivosDelTemplate().filter(esRutaDeEmpresa)).toEqual([]);
  });

  it('el repo hijo tiene su propio .env sin tocar archivos del template', () => {
    const estado = execFileSync(
      'git',
      ['status', '--porcelain', '--ignored', '--untracked-files=all'],
      { cwd: hijo.dir, encoding: 'utf8' }
    )
      .split('\n')
      .filter((l) => l !== '');
    // Ningún archivo versionado del template cambió.
    expect(estado.filter((l) => /^( M|M |.D|D |R )/.test(l))).toEqual([]);
    // Todo lo nuevo es de la empresa.
    const nuevos = estado.map((l) => l.slice(3));
    expect(nuevos.filter((r) => !esRutaDeEmpresa(r))).toEqual([]);
    expect(nuevos).toContain('.env');
    expect(nuevos).toContain('config/empresa.yaml');
    // Los bytes de cada archivo del template son idénticos en el hijo.
    for (const f of archivosDelTemplate()) {
      expect(
        readFileSync(join(hijo.dir, f)).equals(
          readFileSync(join(RAIZ_TEMPLATE, f))
        )
      ).toBe(true);
    }
  });
});
