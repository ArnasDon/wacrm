import fs from 'node:fs';
import { rutaLogoPropio } from '@/lib/marca/marca';

// Config de la empresa montada en runtime: se lee en cada request, nunca en el build.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const logo = rutaLogoPropio();
  if (!logo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(logo.ruta)), {
    headers: {
      'Content-Type': logo.tipo,
      'Cache-Control': 'public, max-age=300',
      // Un SVG abierto directo no debe poder ejecutar scripts.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
