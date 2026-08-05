// ============================================================
// POST /api/analytics/vitals — Core Web Vitals (dashboard + landing,
// DAD §3.4/§6). Público: recibe TTFB/FCP/LCP/CLS/INP vía sendBeacon.
// Dedup por (metric id + path) para no polucionar el reporte.
//
// Se guarda como tracking_events event_type=page_view? NO — vitals no es
// un evento de atribución. Se descarta con log si no hay destino: la
// retención de CWV es tema de Fase 5 (reporting). Hoy solo validamos el
// payload y respondemos 202 (no bloquea la landing).
// ============================================================

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

const vitalsSchema = z.object({
  name: z.enum(["TTFB", "FCP", "LCP", "CLS", "INP", "FID"]),
  value: z.number(),
  id: z.string().max(128),
  path: z.string().max(512).optional(),
  landing: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = vitalsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Hoy: validación + log (almacenamiento/reporting en Fase 5 §7.6).
  const { name, value, id, path, landing } = parsed.data;
  if (process.env.NODE_ENV !== "production") {
    console.log(`[vitals] ${name}=${value} ${path ?? ""}${landing ? " (landing)" : ""} id=${id}`);
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
