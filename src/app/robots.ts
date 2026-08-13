import type { MetadataRoute } from 'next'

import { publicBaseUrl, siteIsIndexable } from '@/lib/seo/public-url'

// ============================================================
// /robots.txt
//
// Antes esto vivía en landing/public/robots.txt, que NO funcionaba: el
// `public/` de Astro se emite bajo `base: '/landing'`, así que el archivo se
// acababa sirviendo en /landing/robots.txt. Los crawlers solo leen
// /robots.txt en la raíz del host, de modo que aquel `Disallow: /` no lo
// aplicaba nadie y la landing con datos de plantilla estaba abierta a
// indexación. Aquí sí se sirve donde toca.
//
// El texto de abajo conserva la razón original del bloqueo:
//
//   Mientras site.ts conserve placeholders (clinicName "Tu Clínica",
//   whatsappNumber falso, baseUrl wacrm.tech), la landing NO debe indexarse:
//   evita que Google indexe "Tu Clínica" con un teléfono que no existe.
//
// Para abrirlo: NEXT_PUBLIC_SITE_INDEXABLE=true y `indexable: true` en
// landing/src/data/site.ts. Ver src/lib/seo/public-url.ts.
// ============================================================

export default function robots(): MetadataRoute.Robots {
  const base = publicBaseUrl()

  if (!siteIsIndexable()) {
    // Sin `sitemap:` mientras está cerrado: anunciar un mapa de páginas que
    // a la vez se prohíbe rastrear es una señal contradictoria.
    return {
      rules: { userAgent: '*', disallow: '/' },
    }
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // El dashboard está detrás de autenticación; un crawler que lo
      // recorre solo gasta presupuesto de rastreo en redirecciones al login.
      disallow: ['/dashboard/', '/api/', '/thank-you', '/thank-you-download'],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
