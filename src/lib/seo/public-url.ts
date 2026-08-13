// ============================================================
// La URL pública del sitio, en un solo sitio.
//
// Misma precedencia que ya usaba src/app/api/telnyx/webhook/route.ts
// (NEXT_PUBLIC_SITE_URL primero, NEXT_PUBLIC_APP_URL de respaldo) para no
// introducir una tercera convención. El literal final coincide con
// `site.baseUrl` de landing/src/data/site.ts, que es el mismo dominio: el
// tsconfig excluye `landing` del proyecto de Next a propósito, así que no se
// puede importar de ahí y hay que repetirlo.
// ============================================================

const FALLBACK = 'https://wacrm.tech'

/** Sin barra final: quien la necesite la añade. */
export function publicBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || FALLBACK
  return raw.replace(/\/+$/, '')
}

/**
 * ¿Se puede indexar el sitio?
 *
 * Por defecto NO. La landing se despliega con los placeholders de
 * `site.ts` — "Tu Clínica", un teléfono que no existe — y dejar que Google
 * indexe eso es peor que no aparecer. Requiere activarlo explícitamente.
 *
 * Al ponerlo a `true` hay que cambiar también `indexable` en
 * landing/src/data/site.ts, que gobierna la etiqueta <meta name="robots">
 * de cada página. Los dos controlan cosas distintas (este el crawler, aquel
 * la etiqueta) y tienen que decir lo mismo.
 */
export function siteIsIndexable(): boolean {
  return process.env.NEXT_PUBLIC_SITE_INDEXABLE === 'true'
}
