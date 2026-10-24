import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { ModulosSchema, type ModuloSwitch } from '@contracts/cfg/tenant-config';

export class ErrorInterruptores extends Error {
  override name = 'ErrorInterruptores';
}

export function dirConfigEmpresa(): string {
  return process.env.CONFIG_EMPRESA_DIR ?? path.join(process.cwd(), 'config');
}

const ArchivoSchema = z.strictObject({ modulos: ModulosSchema });

/**
 * Lee los interruptores de config/modules.yaml (forma de CT.1).
 * Archivo ausente o vacío = todo apagado (R16).
 */
export function leerInterruptores(
  dir: string = dirConfigEmpresa()
): Record<string, ModuloSwitch> {
  const ruta = path.join(dir, 'modules.yaml');
  let texto: string;
  try {
    texto = fs.readFileSync(ruta, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new ErrorInterruptores(`no se pudo leer ${ruta}: ${String(e)}`);
  }
  let doc: unknown;
  try {
    doc = yaml.load(texto);
  } catch (e) {
    throw new ErrorInterruptores(`YAML ilegible en ${ruta}: ${String(e)}`);
  }
  if (doc === undefined || doc === null) return {};
  // `modulos:` sin entradas (todas comentadas) = todo apagado (R16).
  if (
    typeof doc === 'object' &&
    (doc as { modulos?: unknown }).modulos === null
  )
    return {};
  const r = ArchivoSchema.safeParse(doc);
  if (!r.success) {
    const problemas = r.error.issues
      .map((p) => `${p.path.join('.') || '(raíz)'}: ${p.message}`)
      .join('; ');
    throw new ErrorInterruptores(`${ruta} inválido: ${problemas}`);
  }
  return r.data.modulos;
}
