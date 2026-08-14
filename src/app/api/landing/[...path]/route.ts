// ============================================================
// /api/landing/[...path] — servidor estático dinámico de la landing.
//
// El page editor regenera la landing en runtime (live update):
// `astro build` escribe landing/dist y copy-dist.mjs lo publica en
// public/landing. El servidor estático de Next (archivos de public/)
// SOLO sirve archivos que existían en el build del contenedor: los
// HTML regenerados en runtime daban 404 (o quedaban congelados).
//
// Este handler lee public/landing desde el FILESYSTEM REAL en cada
// request, así que:
//   · /landing/<slug>/ nuevo tras guardar → se sirve al instante.
//   · La raíz "/" también (rewrite beforeFiles → este handler).
//   · Los assets (_astro/*.js|css, imágenes, pdf) igual: content-type
//     correcto y cache largo (hasheados, inmutables).
//   · Traversal bloqueado: el path se resuelve y se valida que quede
//     dentro de public/landing.
// ============================================================

import { NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = join(process.cwd(), 'public', 'landing');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function contentType(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

interface Ctx {
  params: Promise<{ path: string[] }>;
}

export async function GET(_request: Request, { params }: Ctx) {
  const segments = (await params).path ?? [];
  // Sanitización: rechaza traversal y rutas absolutas.
  if (segments.some((s) => s === '..' || s.includes('\0'))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  let rel = normalize(segments.join(sep));
  if (rel === '.' || rel === '') rel = 'index.html';
  // Directorio sin archivo → index.html.
  const filePath = resolve(ROOT, rel);
  if (!filePath.startsWith(resolve(ROOT) + sep)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  let target = filePath;
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, 'index.html');
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }

  if (!existsSync(target)) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const isHtml = target.endsWith('.html');
  const headers: Record<string, string> = {
    'Content-Type': contentType(target),
    // HTML: sin cache → el live update se ve al instante.
    // Assets hasheados (_astro/*): cache largo, inmutables.
    'Cache-Control': isHtml
      ? 'no-store, must-revalidate'
      : 'public, max-age=31536000, immutable',
  };

  try {
    const body = await readFile(target);
    return new NextResponse(body, { status: 200, headers });
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }
}