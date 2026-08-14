// ============================================================
// /api/pages/build-status — estado del build de la landing.
//
//   GET — { status: 'idle'|'building'|'done'|'error', ... }
//
// El editor hace polling a este endpoint tras guardar, para saber
// cuándo el HTML regenerado está listo y recargar el preview.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getLandingBuildStatus } from '@/lib/landing-build';

export async function GET() {
  try {
    await getCurrentAccount();
    return NextResponse.json({ status: getLandingBuildStatus() });
  } catch (err) {
    return toErrorResponse(err);
  }
}