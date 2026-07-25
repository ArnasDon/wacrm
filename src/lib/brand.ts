/** Legal / display name — use for titles, meta, UI copy, and emails. */
export const COMPANY_NAME = "VedMint Consultancy Services";

/** Short product label when referring to the CRM app itself. */
export const PRODUCT_NAME = "VedMint CRM";

/** Canonical production URL — shown on auth pages so users can verify legitimacy. */
export const OFFICIAL_APP_URL = "https://wa.vedmint.com";

/** Public wordmark served from `public/logo.png`. */
export const LOGO_PATH = "/logo.png";
export const LOGO_WIDTH = 820;
export const LOGO_HEIGHT = 304;

/** Browser tab icon served from `public/favicon.ico`. */
export const FAVICON_PATH = "/favicon.ico";

/** Auth split-panel background — team collaboration (public/auth-brand.jpg). */
export const AUTH_BRAND_IMAGE_PATH = "/auth-brand.jpg";

/** Absolute logo URL for emails and Open Graph metadata. */
export function logoUrl(origin: string = OFFICIAL_APP_URL): string {
  return `${origin.replace(/\/+$/, "")}${LOGO_PATH}`;
}

/** Absolute favicon URL for metadata and external references. */
export function faviconUrl(origin: string = OFFICIAL_APP_URL): string {
  return `${origin.replace(/\/+$/, "")}${FAVICON_PATH}`;
}

/** VedMint wordmark palette — navy ("Ved") + mint ("Mint"). */
export const VEDMINT_NAVY = "#1e293b";
export const VEDMINT_MINT = "#14b8a6";
export const VEDMINT_MINT_DARK = "#0d9488";

export const SUPPORT_EMAIL = "support@vedmint.com";

export const META_DESCRIPTION =
  "WhatsApp & Email CRM by VedMint Consultancy Services — shared inbox, contacts, pipelines, WhatsApp broadcasts, BYO SMTP email marketing, and automations.";

export const COPYRIGHT_NOTICE = `© ${new Date().getFullYear()} ${COMPANY_NAME}. All Rights Reserved.`;

/**
 * VedMint Suite — products shown in the public navbar dropdown.
 * Order matches the suite menu: WA CRM, Discover, Stay ERP, then main site.
 */
export const VEDMINT_SUITE = [
  {
    id: "wa-crm",
    name: "WA CRM",
    url: OFFICIAL_APP_URL,
    description: "WhatsApp Business CRM & automation",
    /** Current app — open in same tab */
    external: false as const,
  },
  {
    id: "discover",
    name: "VedMint Discover",
    url: "https://discover.vedmint.com",
    description: "Listings, guides & local discovery",
    external: true as const,
  },
  {
    id: "stay",
    name: "Stay ERP",
    url: "https://stay.vedmint.com",
    description:
      "Property and stay management for hotels, homestays, Rental Properties partners.",
    external: true as const,
  },
  {
    id: "main",
    name: "VedMint",
    url: "https://www.vedmint.com",
    description: "Consultancy & digital solutions",
    external: true as const,
  },
] as const;

/** VedMint product ecosystem — cards on marketing pages (excludes self). */
export const VEDMINT_ECOSYSTEM = [
  {
    id: "main",
    name: "VedMint",
    url: "https://www.vedmint.com",
    tagline: "Consultancy & digital solutions",
    description:
      "Our main site — services, company profile, and how we help businesses grow with WhatsApp and CRM.",
  },
  {
    id: "discover",
    name: "VedMint Discover",
    url: "https://discover.vedmint.com",
    tagline: "Listings, guides & local discovery",
    description:
      "Browse listings, guides, and local discovery across the VedMint platform family.",
  },
  {
    id: "stay",
    name: "Stay ERP",
    url: "https://stay.vedmint.com",
    tagline: "Hospitality & stays",
    description:
      "Property and stay management for hotels, homestays, and rental property partners.",
  },
] as const;
