import type { MetadataRoute } from "next";

/**
 * Indexação do domínio de marketing (centraldereceita.com.br).
 * Só as páginas públicas entram na busca; o app (atrás de login) segue
 * com noindex no layout e fica fora do rastreio.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/oferta$"],
      disallow: ["/"],
    },
    sitemap: "https://www.centraldereceita.com.br/sitemap.xml",
    host: "https://www.centraldereceita.com.br",
  };
}
