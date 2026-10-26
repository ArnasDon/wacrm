import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { dirConfigEmpresa } from '@/modulos/interruptores';
import { esHexColor } from './color';

export const COLOR_DEFECTO = '#2f7bf5';
const NOMBRE_DEFECTO = 'Stackless';

/** Mismos valores que scripts/empresa/nueva-empresa.mjs (una prueba los fija). */
export const TIPOS_LOGO: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};
export const LOGO_MAX_BYTES = 1024 * 1024;

export type Marca = {
  nombre: string;
  color: string;
  logoPropio: boolean;
  /** Logo completo (con nombre), para el login. */
  logoUrl: string;
  /** Isotipo/logo compacto, para el sidebar. */
  marcaUrl: string;
};

function leerYaml(ruta: string): Record<string, unknown> {
  try {
    const doc = yaml.load(fs.readFileSync(ruta, 'utf8'));
    return typeof doc === 'object' && doc !== null
      ? (doc as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function objeto(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null
    ? (v as Record<string, unknown>)
    : {};
}

/** Ruta absoluta y tipo del logo propio, o null si no hay uno válido. */
export function rutaLogoPropio(
  dir: string = dirConfigEmpresa()
): { ruta: string; tipo: string } | null {
  const archivo = objeto(leerYaml(path.join(dir, 'marca.yaml')).marca).logo;
  if (typeof archivo !== 'string' || archivo === '') return null;
  const carpeta = path.join(dir, 'marca');
  const ruta = path.resolve(carpeta, archivo);
  if (path.dirname(ruta) !== carpeta) return null;
  const tipo = TIPOS_LOGO[path.extname(ruta).toLowerCase()];
  if (!tipo) return null;
  try {
    const st = fs.statSync(ruta);
    if (!st.isFile() || st.size > LOGO_MAX_BYTES) return null;
  } catch {
    return null;
  }
  return { ruta, tipo };
}

/** Marca de la empresa; cualquier dato ausente o inválido cae al de Stackless. */
export function leerMarca(dir: string = dirConfigEmpresa()): Marca {
  const nombre = objeto(leerYaml(path.join(dir, 'empresa.yaml')).empresa)
    .nombre;
  const color = objeto(leerYaml(path.join(dir, 'marca.yaml')).marca).color;
  const logoPropio = rutaLogoPropio(dir) !== null;
  return {
    nombre:
      typeof nombre === 'string' && nombre.trim() !== ''
        ? nombre.trim()
        : NOMBRE_DEFECTO,
    color:
      typeof color === 'string' && esHexColor(color) ? color : COLOR_DEFECTO,
    logoPropio,
    logoUrl: logoPropio ? '/marca/logo' : '/stackless/logo.png',
    marcaUrl: logoPropio ? '/marca/logo' : '/stackless/mark.png',
  };
}
