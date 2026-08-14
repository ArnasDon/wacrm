// ============================================================
// landing-pages.ts — lectura/escritura de landings en disco.
//
// Las landings viven como JSON en landing/src/data/landings/<slug>.json y
// son la fuente de verdad de la Content Collection de Astro (el build de la
// landing las valida y renderiza). El page editor del dashboard las lee,
// las crea y las guarda aquí.
//
// Convención de slug: [a-z0-9]+(-[a-z0-9]+)* — minúsculas, guiones, sin
// espacios ni caracteres especiales. El nombre del archivo ES el slug.
// ============================================================

import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export { BLOCK_TYPES, RESERVED_SLUGS } from './landing-block-types';

// Resuelto en cada llamada (no en import time) para que los tests puedan
// redirigir process.cwd() a un directorio temporal.
import type { LandingSettings } from './landing-settings';

function landingsDir(): string {
  return join(process.cwd(), 'landing', 'src', 'data', 'landings');
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface LandingBlock {
  type: string;
  data: Record<string, unknown>;
}

export interface LandingPage {
  slug: string;
  title: string;
  description: string;
  blocks: LandingBlock[];
  /** Ajustes del sitio (opcional) — override del site.ts global. */
  settings?: LandingSettings;
}

/** Valida un slug de página. Devuelve un mensaje de error o null si es válido. */
export function validateSlug(slug: string): string | null {
  if (!slug) return 'El slug es obligatorio.';
  if (slug.length > 64) return 'El slug no puede superar 64 caracteres.';
  if (!SLUG_RE.test(slug)) {
    return 'Usa solo minúsculas, números y guiones (ej: fisioterapia-deportiva).';
  }
  return null;
}

/** Ruta absoluta del archivo JSON de una landing. */
function filePath(slug: string): string {
  return join(landingsDir(), `${slug}.json`);
}

/**
 * Lista todas las landings. Devuelve metadata (slug, título) sin los bloques
 * para que la lista del editor sea ligera.
 */
export async function listLandings(): Promise<{ slug: string; title: string }[]> {
  const entries = await fs.readdir(landingsDir(), { withFileTypes: true });
  const slugs = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name.replace(/\.json$/, ''))
    .sort();

  const pages = await Promise.all(
    slugs.map(async (slug) => {
      try {
        const page = await readLanding(slug);
        return { slug, title: page.title };
      } catch {
        // Un JSON roto no debe tumbar la lista: se muestra con título fallback.
        return { slug, title: slug };
      }
    }),
  );
  return pages;
}

/** Lee una landing completa. Lanza si no existe o el JSON está roto. */
export async function readLanding(slug: string): Promise<LandingPage> {
  const raw = await fs.readFile(filePath(slug), 'utf-8');
  const parsed = JSON.parse(raw) as {
    title?: string;
    description?: string;
    blocks?: LandingBlock[];
    settings?: LandingSettings;
  };
  return {
    slug,
    title: parsed.title ?? slug,
    description: parsed.description ?? '',
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
    settings: parsed.settings,
  };
}

/** Crea una landing nueva con un documento mínimo. Lanza si el slug existe. */
export async function createLanding(slug: string, title: string, description: string): Promise<LandingPage> {
  const invalid = validateSlug(slug);
  if (invalid) throw new Error(invalid);

  try {
    await fs.access(filePath(slug));
    throw new Error(`Ya existe una página con el slug "${slug}".`);
  } catch (err) {
    // ENOENT = no existe → OK crear. Cualquier otro error se propaga.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const page: LandingPage = {
    slug,
    title: title || slug,
    description: description || '',
    blocks: [{ type: 'hero-centered', data: { title: title || slug } }],
  };
  await writeLanding(page);
  return page;
}

/** Guarda una landing (crea o sobrescribe). Valida el slug. */
export async function writeLanding(page: LandingPage): Promise<void> {
  const invalid = validateSlug(page.slug);
  if (invalid) throw new Error(invalid);

  const doc: Record<string, unknown> = {
    title: page.title,
    description: page.description,
    blocks: page.blocks,
  };
  // settings solo se escribe si está definido (el editor lo envía al PUT).
  if (page.settings !== undefined) {
    doc.settings = page.settings;
  }
  const json = `${JSON.stringify(doc, null, 2)}\n`;
  await fs.mkdir(landingsDir(), { recursive: true });
  await fs.writeFile(filePath(page.slug), json, 'utf-8');
}