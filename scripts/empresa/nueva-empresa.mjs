#!/usr/bin/env node
/**
 * Convierte un clon de la plantilla en el repo hijo de una empresa (CFG.1).
 *
 * Uso:
 *   node scripts/empresa/nueva-empresa.mjs --id <id> --nombre <nombre> [--dir <ruta>]
 *     [--meta-app-secret <v>] [--backup-destino <v>] [--backup-credencial <v>] [--backup-aviso <v>]
 *
 * Crea en el directorio del hijo:
 *   config/empresa.yaml, config/modules.yaml, config/policies.yaml  (desde config.ejemplo/)
 *   .env  (desde .env.example + llaves nuevas + COMPOSE_PROJECT_NAME=wacrm-<id>)
 *
 * Nunca reescribe: si ya existe .env o config/, sale con error sin escribir nada
 * (regenerar ENCRYPTION_KEY dejaría ilegibles los secretos cifrados, R7).
 * Sin dependencias, como scripts/supabase-keys.mjs.
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Misma expresión que IDENTIFICADOR en contracts/cfg/tenant-config.ts (una prueba lo fija).
const IDENTIFICADOR = /^[a-z][a-z0-9-]*$/;

const EJEMPLOS = ['empresa.yaml', 'modules.yaml', 'policies.yaml'];

function fallar(mensaje) {
  process.stderr.write(`nueva-empresa: ${mensaje}\n`);
  process.exit(1);
}

let args;
try {
  args = parseArgs({
    options: {
      id: { type: 'string' },
      nombre: { type: 'string' },
      dir: { type: 'string' },
      'meta-app-secret': { type: 'string' },
      'backup-destino': { type: 'string' },
      'backup-credencial': { type: 'string' },
      'backup-aviso': { type: 'string' },
    },
    strict: true,
  }).values;
} catch (e) {
  fallar(e.message);
}

const dir = resolve(args.dir ?? process.cwd());
const id = args.id ?? '';
const nombre = args.nombre ?? '';

if (!IDENTIFICADOR.test(id)) {
  fallar(
    `--id ${JSON.stringify(id)} no es válido: minúsculas, dígitos y guiones, empezando por letra`
  );
}
if (nombre.trim() === '') fallar('falta --nombre');
if (existsSync(join(dir, '.env'))) {
  fallar(`ya existe ${join(dir, '.env')}: este repo ya es de una empresa`);
}
if (existsSync(join(dir, 'config'))) {
  fallar(`ya existe ${join(dir, 'config')}: este repo ya es de una empresa`);
}
for (const f of EJEMPLOS) {
  if (!existsSync(join(dir, 'config.ejemplo', f))) {
    fallar(`falta config.ejemplo/${f} en ${dir}`);
  }
}
if (!existsSync(join(dir, '.env.example'))) {
  fallar(`falta .env.example en ${dir}`);
}

const aqui = dirname(fileURLToPath(import.meta.url));
const llaves = execFileSync(
  process.execPath,
  [join(aqui, '..', 'supabase-keys.mjs')],
  { encoding: 'utf8' }
);
const generadas = {};
for (const linea of llaves.trim().split('\n')) {
  const i = linea.indexOf('=');
  if (i > 0) generadas[linea.slice(0, i)] = linea.slice(i + 1);
}

let ejemplo = readFileSync(join(dir, '.env.example'), 'utf8');
if (!ejemplo.endsWith('\n')) ejemplo += '\n';

const extras = [
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${generadas.ANON_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${generadas.SERVICE_ROLE_KEY}`,
  `COMPOSE_PROJECT_NAME=wacrm-${id}`,
];
const opcionales = [
  ['meta-app-secret', 'META_APP_SECRET'],
  ['backup-destino', 'BACKUP_DESTINO_URI'],
  ['backup-credencial', 'BACKUP_DESTINO_CREDENCIAL'],
  ['backup-aviso', 'BACKUP_AVISO_WEBHOOK'],
];
for (const [flag, variable] of opcionales) {
  if (args[flag] !== undefined) extras.push(`${variable}=${args[flag]}`);
}

// Todo validado: a partir de aquí se escribe.
mkdirSync(join(dir, 'config'));
for (const f of EJEMPLOS) {
  copyFileSync(join(dir, 'config.ejemplo', f), join(dir, 'config', f));
}
// JSON.stringify da un escalar YAML válido para cualquier nombre.
writeFileSync(
  join(dir, 'config', 'empresa.yaml'),
  `# Identidad de la empresa.\nempresa:\n  id: ${id}\n  nombre: ${JSON.stringify(nombre)}\n`
);
writeFileSync(join(dir, '.env'), ejemplo + llaves + extras.join('\n') + '\n', {
  mode: 0o600,
});

process.stdout.write(
  [
    `Repo hijo de "${nombre}" (${id}) listo.`,
    '',
    'Siguientes pasos:',
    '  1. Revisa el .env (META_APP_SECRET y BACKUP_* si no los pasaste como flags).',
    '  2. docker compose up -d --wait',
    '  3. Guarda el .env fuera del repo (gestor de secretos); no se commitea.',
    '  4. git add config/ && git commit -m "config de la empresa"',
    '',
  ].join('\n')
);
