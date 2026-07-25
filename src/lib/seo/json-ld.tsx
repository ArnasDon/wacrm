import {
  COMPANY_NAME,
  logoUrl,
  OFFICIAL_APP_URL,
  PRODUCT_NAME,
  SUPPORT_EMAIL,
} from "@/lib/brand";
import type { SeoPage } from "@/lib/seo/whatsapp-crm-pages";

function abs(path: string): string {
  const base = OFFICIAL_APP_URL.replace(/\/+$/, "");
  if (!path || path === "/") return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: COMPANY_NAME,
    url: "https://www.vedmint.com",
    logo: logoUrl(),
    email: SUPPORT_EMAIL,
    sameAs: [
      "https://www.vedmint.com",
      "https://stay.vedmint.com",
      "https://discover.vedmint.com",
      OFFICIAL_APP_URL,
    ],
  };
}

export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: PRODUCT_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: OFFICIAL_APP_URL,
    description:
      "WhatsApp Business CRM with shared inbox, contacts, pipelines, WhatsApp broadcasts, email marketing, and automations.",
    offers: {
      "@type": "Offer",
      url: abs("/pricing"),
      priceCurrency: "INR",
      availability: "https://schema.org/InStock",
    },
    provider: {
      "@type": "Organization",
      name: COMPANY_NAME,
      url: "https://www.vedmint.com",
    },
  };
}

export function breadcrumbJsonLd(page: SeoPage) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: OFFICIAL_APP_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "WhatsApp CRM Guides",
        item: abs("/whatsapp-crm"),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: page.industry,
        item: abs(`/whatsapp-crm/${page.industrySlug}`),
      },
      {
        "@type": "ListItem",
        position: 4,
        name: page.country,
        item: abs(page.path),
      },
    ],
  };
}

export function articleJsonLd(page: SeoPage) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.headline,
    description: page.description,
    image: [logoUrl()],
    datePublished: page.datePublished,
    dateModified: page.dateModified,
    author: {
      "@type": "Organization",
      name: page.authorName,
      url: "https://www.vedmint.com",
    },
    publisher: {
      "@type": "Organization",
      name: page.publisherName,
      logo: {
        "@type": "ImageObject",
        url: logoUrl(),
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": abs(page.path),
    },
    about: [
      {
        "@type": "Thing",
        name: "WhatsApp Business API",
      },
      {
        "@type": "Thing",
        name: "Email marketing CRM",
      },
      {
        "@type": "Thing",
        name: `${page.industry} CRM`,
      },
    ],
    inLanguage: "en",
    keywords: page.keywords.join(", "),
  };
}

export function faqJsonLd(page: SeoPage) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    })),
  };
}

export function seoPageJsonLdGraph(page: SeoPage) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationJsonLd(),
      softwareApplicationJsonLd(),
      breadcrumbJsonLd(page),
      articleJsonLd(page),
      faqJsonLd(page),
    ],
  };
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
