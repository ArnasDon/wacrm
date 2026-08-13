import type { MetadataRoute } from 'next'

import { publicBaseUrl } from '@/lib/seo/public-url'

// ============================================================
// /sitemap.xml
//
// Vive en Next, no en Astro, por una razón de protocolo: un sitemap solo
// cubre las URLs que cuelgan de su propio directorio, y Astro construye con
// `base: '/landing'`, así que un sitemap emitido por Astro se serviría en
// /landing/sitemap.xml y no tendría autoridad sobre `/`. Aquí sí.
//
// Solo entra lo indexable. Las dos páginas de gracias (/thank-you y
// /thank-you-download) llevan `noindex` y quedan fuera a propósito:
// listarlas en el sitemap y prohibirlas en la etiqueta es una contradicción
// que Search Console reporta como error, y una página de gracias que llega a
// indexarse genera conversiones falsas desde búsqueda orgánica.
//
// El dashboard tampoco entra: está detrás de autenticación.
//
// Sin `lastModified`: se evaluaría en cada build y le diría al crawler que la
// página cambió cuando lo único que cambió fue el despliegue. Una fecha falsa
// es peor que ninguna.
// ============================================================

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: publicBaseUrl(),
      changeFrequency: 'monthly',
      priority: 1,
    },
  ]
}
