// ============================================================
// /api/pages — page editor endpoints.
//
//   GET  — list all landing pages (slug + title, no blocks).
//   POST — create a new landing page.
//
// Authenticated via cookie session (getCurrentAccount), same as the other
// dashboard endpoints. Body of POST:
//   { "slug": "fisioterapia-deportiva", "title": "...", "description": "..." }
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { createLanding, listLandings, validateSlug } from '@/lib/landing-pages';

export async function GET() {
  try {
    await getCurrentAccount();
    const pages = await listLandings();
    return NextResponse.json({ pages });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    await getCurrentAccount();

    const body = (await request.json().catch(() => null)) as
      | { slug?: string; title?: string; description?: string }
      | null;
    if (!body) {
      return NextResponse.json({ error: 'Cuerpo de petición inválido.' }, { status: 400 });
    }

    const slug = (body.slug ?? '').trim().toLowerCase();
    const invalid = validateSlug(slug);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }

    const page = await createLanding(slug, body.title ?? '', body.description ?? '');
    return NextResponse.json({ page }, { status: 201 });
  } catch (err) {
    if ((err as Error).message.startsWith('Ya existe')) {
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    }
    return toErrorResponse(err);
  }
}