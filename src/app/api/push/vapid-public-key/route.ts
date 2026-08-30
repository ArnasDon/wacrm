import { NextResponse } from 'next/server';

/**
 * GET /api/push/vapid-public-key
 *
 * The VAPID public key is not a secret (it's the `applicationServerKey`
 * every subscriber embeds). The client normally reads it from the
 * inlined `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; this endpoint exists so the
 * service worker — which can't see build-time env — can re-subscribe
 * on `pushsubscriptionchange`.
 */
export function GET() {
  return NextResponse.json({ key: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null });
}
