// ============================================================
// /api/pages/[slug] — single landing page.
//
//   GET — read one page (full document: title, description, blocks).
//   PUT — save one page (full document replace) and recompile the
//         landing (live update): the Astro build regenerates the
//         served HTML in the background without rebuilding Next.
//
// Body of PUT:
//   { "title": "...", "description": "...", "blocks": [...], "settings": {...} }
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { requestLandingBuild } from '@/lib/landing-build';
import { readLanding, validateSlug, writeLanding } from '@/lib/landing-pages';
import type { LandingSettings } from '@/lib/landing-settings';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { slug } = await params;
  try {
    await getCurrentAccount();

    const invalid = validateSlug(slug);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }

    const page = await readLanding(slug);
    return NextResponse.json({ page });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: `No existe la página "${slug}".` }, { status: 404 });
    }
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { slug } = await params;
  try {
    await getCurrentAccount();

    const invalid = validateSlug(slug);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as
      | { title?: string; description?: string; blocks?: unknown; settings?: unknown }
      | null;
    if (!body || typeof body.title !== 'string' || !Array.isArray(body.blocks)) {
      return NextResponse.json(
        { error: 'Cuerpo inválido: se esperan title (string), description (string) y blocks (array).' },
        { status: 400 },
      );
    }

    const page = {
      slug,
      title: body.title,
      description: body.description ?? '',
      blocks: body.blocks,
      // settings es opcional: solo se escribe si el editor lo envía.
      ...(body.settings !== undefined
        ? { settings: body.settings as LandingSettings }
        : {}),
    };
    await writeLanding(page);

    // Live update: recompilar la landing en segundo plano. El editor hace
    // polling de /api/pages/build-status para saber cuándo está listo.
    requestLandingBuild();

    return NextResponse.json({ page });
  } catch (err) {
    return toErrorResponse(err);
  }
}