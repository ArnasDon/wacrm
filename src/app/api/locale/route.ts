// ============================================================
// POST /api/locale
//
// Sets the NEXT_LOCALE cookie the language switcher uses to override
// the deployment's default locale for this browser (see
// src/i18n/request.ts). No auth required — a display-language
// preference isn't sensitive, and this needs to work from the
// (unauthenticated) login page too.
// ============================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { LOCALE_COOKIE, SUPPORTED_LOCALES, type SupportedLocale } from '@/i18n/request'

export async function POST(request: Request) {
  let body: { locale?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const locale = body.locale
  if (!locale || !SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
    return NextResponse.json(
      { error: `locale must be one of: ${SUPPORTED_LOCALES.join(', ')}` },
      { status: 400 }
    )
  }

  const cookieStore = await cookies()
  cookieStore.set(LOCALE_COOKIE, locale, {
    // A year — same order of magnitude as the theme preference cookie's
    // intent (a "sticky until changed" setting), and long enough that
    // no one notices it "forgetting" their language.
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
    sameSite: 'lax',
  })

  return NextResponse.json({ success: true, locale })
}
