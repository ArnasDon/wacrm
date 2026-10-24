/**
 * IT: un repo hijo creado desde la plantilla arranca con su propio .env y su propia base.
 *
 * Apagada por defecto: solo corre con COMPOSE_IT=1 (workflow compose-it.yml).
 * El hijo vive en un directorio temporal; el .env del template no se toca.
 */
import { execFileSync } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { VOLUME_NAMES } from '../../contracts/base/compose-services';
import { esRutaDeEmpresa } from '../../contracts/cfg/tenant-config';
import { crearRepoHijo, type RepoHijo } from './repo-hijo';

const PROYECTO = 'wacrm-empresa-it';

describe.skipIf(process.env['COMPOSE_IT'] !== '1')(
  'repo hijo creado desde la plantilla',
  () => {
    let hijo: RepoHijo;

    const run = (cmd: string, args: string[]) =>
      execFileSync(cmd, args, {
        cwd: hijo.dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 20 * 1024 * 1024,
      });
    const compose = (...args: string[]) => run('docker', ['compose', ...args]);

    beforeAll(() => {
      hijo = crearRepoHijo({ id: 'empresa-it', nombre: 'Empresa IT' });
    }, 120_000);

    afterAll(() => {
      if (!hijo) return;
      try {
        compose('down', '-v', '--remove-orphans');
      } finally {
        hijo.limpiar();
      }
    }, 300_000);

    it('usa el proyecto de Compose de la empresa', () => {
      const cfg = JSON.parse(compose('config', '--format', 'json')) as {
        name: string;
      };
      expect(cfg.name).toBe(PROYECTO);
    });

    it('arranca en healthy con su propio .env', () => {
      try {
        compose('up', '-d', '--wait', '--wait-timeout', '600');
      } catch (e) {
        console.error(compose('ps'));
        console.error(compose('logs', '--tail', '200'));
        throw e;
      }
      const filas = compose('ps', '--format', 'json')
        .trim()
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => JSON.parse(l) as { Service: string; Health: string });
      for (const f of filas.filter((x) => x.Health !== '')) {
        expect(`${f.Service}=${f.Health}`).toBe(`${f.Service}=healthy`);
      }
    }, 900_000);

    it('tiene su propia base: los volúmenes son del proyecto de la empresa', () => {
      const de = (proyecto: string) =>
        run('docker', [
          'volume',
          'ls',
          '--filter',
          `label=com.docker.compose.project=${proyecto}`,
          '--format',
          '{{.Name}}',
        ])
          .split('\n')
          .filter((l) => l !== '');
      const propios = de(PROYECTO);
      for (const v of VOLUME_NAMES)
        expect(propios).toContain(`${PROYECTO}_${v}`);
      expect(de('wacrm')).toEqual([]);
    });

    it('arrancar no tocó archivos del template', () => {
      const estado = run('git', [
        'status',
        '--porcelain',
        '--ignored',
        '--untracked-files=all',
      ])
        .split('\n')
        .filter((l) => l !== '');
      expect(estado.filter((l) => /^( M|M |.D|D |R )/.test(l))).toEqual([]);
      expect(
        estado.map((l) => l.slice(3)).filter((r) => !esRutaDeEmpresa(r))
      ).toEqual([]);
    });
  }
);
