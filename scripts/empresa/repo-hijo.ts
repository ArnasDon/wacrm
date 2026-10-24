import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const RAIZ_TEMPLATE = process.cwd();

/** Archivos versionados del template que existen en el árbol de trabajo. */
export function archivosDelTemplate(): string[] {
  const salida = execFileSync('git', ['ls-files', '-z'], {
    cwd: RAIZ_TEMPLATE,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return salida
    .split('\0')
    .filter((f) => f !== '' && existsSync(join(RAIZ_TEMPLATE, f)));
}

/** KEY=VALUE por línea; ignora comentarios y vacías; la última definición gana. */
export function leerEnv(ruta: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const t = linea.trim();
    if (t === '' || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) env[t.slice(0, i)] = t.slice(i + 1);
  }
  return env;
}

export type RepoHijo = {
  dir: string;
  env: Record<string, string>;
  limpiar(): void;
};

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'plantilla',
  GIT_AUTHOR_EMAIL: 'plantilla@example.com',
  GIT_COMMITTER_NAME: 'plantilla',
  GIT_COMMITTER_EMAIL: 'plantilla@example.com',
};

/** Crea un hijo desechable a partir de los archivos versionados del template. */
export function crearRepoHijo(opciones: {
  id: string;
  nombre: string;
  flags?: string[];
}): RepoHijo {
  const dir = mkdtempSync(join(tmpdir(), 'repo-hijo-'));
  try {
    for (const f of archivosDelTemplate()) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      copyFileSync(join(RAIZ_TEMPLATE, f), join(dir, f));
    }
    const git = (...a: string[]) =>
      execFileSync('git', a, {
        cwd: dir,
        stdio: 'pipe',
        env: { ...process.env, ...GIT_ENV },
      });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'plantilla');
    execFileSync(
      process.execPath,
      [
        join(RAIZ_TEMPLATE, 'scripts', 'empresa', 'nueva-empresa.mjs'),
        '--dir',
        dir,
        '--id',
        opciones.id,
        '--nombre',
        opciones.nombre,
        '--meta-app-secret',
        'secreto-de-prueba',
        '--backup-destino',
        `s3://backups/${opciones.id}`,
        '--backup-credencial',
        'type = s3',
        '--backup-aviso',
        'https://avisos.example.com/b',
        ...(opciones.flags ?? []),
      ],
      { stdio: 'pipe' }
    );
    return {
      dir,
      env: leerEnv(join(dir, '.env')),
      limpiar: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}
