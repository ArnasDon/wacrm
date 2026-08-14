// ============================================================
// landing-build.ts — recompilación de la landing en runtime.
//
// "Live update": cuando el editor guarda un JSON, /api/pages/[slug]
// dispara este build para que el cambio se vea SIN recompilar Next ni
// reiniciar el contenedor. `astro build` regenera landing/dist y
// copy-dist.mjs lo publica en public/landing (que Next sirve vía
// rewrites), así que el preview y el sitio actualizan al instante.
//
// El comando es FIJO (sin interpolación de entrada del usuario):
//   node <astro.js> build --root <landing> --outDir <landing/dist>
// Correr en el contenedor requiere un entorno astro instalado en el
// runner (ver Dockerfile, dir /app/astro-env). En desarrollo local se
// usa el astro del workspace.
//
// Un solo build a la vez: si ya hay uno en curso, un nuevo request se
// ignora (no se encola). El editor hace polling de getLandingBuildStatus
// para recargar el preview cuando termina.
// ============================================================

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type LandingBuildStatus = 'idle' | 'building' | 'done' | 'error';

export interface LandingBuildState {
  status: LandingBuildStatus;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

let state: LandingBuildState = {
  status: 'idle',
  requestedAt: null,
  startedAt: null,
  finishedAt: null,
  error: null,
};

const now = () => new Date().toISOString();

export function getLandingBuildStatus(): LandingBuildState {
  return { ...state };
}

/** Localiza el binario de Astro (runner docker o dev local). */
function astroBinary(root: string): string {
  const candidates = [
    // astro ≥7: bin/astro.mjs (Dockerfile instala astro en /app/astro-env).
    join(root, 'astro-env', 'node_modules', 'astro', 'bin', 'astro.mjs'),
    // Dev local: dependencia de la landing del workspace.
    join(root, 'landing', 'node_modules', 'astro', 'bin', 'astro.mjs'),
    join(root, 'landing', 'node_modules', '.bin', 'astro'),
    join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'),
    // astro <7: astro.js en la raíz del paquete.
    join(root, 'astro-env', 'node_modules', 'astro', 'astro.js'),
    join(root, 'node_modules', 'astro', 'astro.js'),
    join(root, 'node_modules', '.bin', 'astro'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

/**
 * Dispara la recompilación de la landing en segundo plano (fire-and-forget).
 * El caller NO debe esperarlo: devuelve al instante y el build corre suelto.
 */
export function requestLandingBuild(): void {
  if (state.status === 'building') return; // un build a la vez

  const stamp = now();
  state = { status: 'building', requestedAt: stamp, startedAt: stamp, finishedAt: null, error: null };

  // No bloquear el event loop del servidor: el build es child process.
  void run().finally(() => {
    state = { ...state, finishedAt: now() };
  });
}

async function run(): Promise<void> {
  try {
    const root = process.cwd();
    const astro = astroBinary(root);
    const landingRoot = join(root, 'landing');
    const outDir = join(landingRoot, 'dist');

    await exec('node', [astro, 'build', '--root', landingRoot, '--outDir', outDir], {
      timeout: 180_000,
      // execFile captura stdout/stderr por defecto (pipe): no se heredan.
      maxBuffer: 4 * 1024 * 1024,
    });
    await exec('node', [join(landingRoot, 'scripts', 'copy-dist.mjs')], {
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });

    state.status = 'done';
  } catch (err) {
    state.status = 'error';
    state.error = err instanceof Error ? err.message : String(err);
  }
}