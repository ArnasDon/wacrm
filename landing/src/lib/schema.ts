// ============================================================
// Grafo de datos estructurados (skill §9.2).
//
// Cada página emite UN SOLO bloque JSON-LD con un `@graph`, donde los nodos
// se referencian entre sí por `@id` en lugar de duplicarse. El tipo del
// negocio sale de `site.schemaType`, no se escribe fijo.
// ============================================================

import { site } from "../data/site";

export type SchemaNode = Record<string, unknown> & { "@type": string; "@id"?: string };

/** El tipo de servicio se deriva del tipo de negocio (skill §9.2). */
function serviceType(businessType: string): string {
  if (["MedicalClinic", "Physician", "Hospital"].includes(businessType)) {
    return "MedicalProcedure";
  }
  if (businessType === "Dentist") return "DentalProcedure";
  if (businessType === "Product") return "Product";
  return "Service";
}

interface GraphInput {
  /** URL absoluta de la página actual. */
  url: string;
  title: string;
  description: string;
  /** Migas: todos los niveles salvo el último llevan `item`. */
  breadcrumb?: { name: string; item?: string }[];
  /** Emite el nodo FAQPage. Mínimo 2 preguntas. */
  faq?: readonly { q: string; a: string }[];
  /** Emite el nodo HowTo. Mínimo 2 pasos. */
  steps?: readonly { title: string; text: string }[];
}

export function buildGraph({
  url,
  title,
  description,
  breadcrumb = [],
  faq = [],
  steps = [],
}: GraphInput): { "@context": string; "@graph": SchemaNode[] } {
  const siteUrl = site.baseUrl;
  const ogImage = `${siteUrl}${site.ogImage}`;
  const graph: SchemaNode[] = [];

  graph.push({
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: title,
    description,
    isPartOf: { "@id": `${siteUrl}#website` },
    author: { "@id": `${siteUrl}#author` },
    primaryImageOfPage: { "@id": `${url}#primaryimage` },
    ...(breadcrumb.length ? { breadcrumb: { "@id": `${url}#breadcrumb` } } : {}),
    inLanguage: site.lang,
  });

  if (breadcrumb.length) {
    graph.push({
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: breadcrumb.map((b, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: b.name,
        ...(b.item ? { item: b.item } : {}),
      })),
    });
  }

  graph.push({
    "@type": "ImageObject",
    "@id": `${url}#primaryimage`,
    url: ogImage,
    contentUrl: ogImage,
    width: 1200,
    height: 630,
  });

  graph.push({
    "@type": "WebSite",
    "@id": `${siteUrl}#website`,
    url: siteUrl,
    name: site.name,
    inLanguage: site.lang,
    ...(site.social.length ? { sameAs: [...site.social] } : {}),
  });

  graph.push({
    "@type": "Person",
    "@id": `${siteUrl}#author`,
    name: site.author.name,
    url: site.author.url,
    image: `${siteUrl}${site.author.image}`,
    jobTitle: site.author.jobTitle,
    knowsAbout: [...site.author.knowsAbout],
    ...(site.author.sameAs.length ? { sameAs: [...site.author.sameAs] } : {}),
  });

  // Entidad principal del negocio. `areaServed` va como array de nodos
  // Country, uno por país: agrupar varios en un solo nodo es incorrecto.
  graph.push({
    "@type": site.schemaType,
    "@id": `${siteUrl}#business`,
    name: site.name,
    legalName: site.legalName,
    url: siteUrl,
    telephone: site.phone,
    email: site.email,
    priceRange: site.priceRange,
    image: `${siteUrl}${site.logo}`,
    logo: `${siteUrl}${site.logo}`,
    description,
    address: {
      "@type": "PostalAddress",
      streetAddress: site.address.street,
      addressLocality: site.address.locality,
      addressRegion: site.address.region,
      postalCode: site.address.postalCode,
      addressCountry: site.address.country,
    },
    areaServed: site.areaServed.map((c) => ({ "@type": "Country", name: c })),
    openingHours: site.openingHours,
    knowsLanguage: [...site.languages],
    paymentAccepted: [...site.paymentAccepted],
    currenciesAccepted: site.currency,
    // Sin aggregateRating: no hay reseñas reales que lo respalden, y declarar
    // una calificación que no corresponde al contenido visible es un dato
    // estructurado falso (skill §9.2).
    availableService: site.services.map((s) => ({
      "@type": serviceType(site.schemaType),
      name: s.name,
      description: s.desc,
      offers: {
        "@type": "Offer",
        price: s.price,
        priceCurrency: site.currency,
      },
    })),
  });

  if (faq.length >= 2) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  if (steps.length >= 2) {
    graph.push({
      "@type": "HowTo",
      "@id": `${url}#howto`,
      name: `Cómo empezar tu tratamiento en ${site.name}`,
      step: steps.map((s, i) => ({
        "@type": "HowToStep",
        position: i + 1,
        name: s.title,
        text: s.text,
      })),
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}
