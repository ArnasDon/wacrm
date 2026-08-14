// ============================================================
// site-context.ts — resolución de los "Ajustes del sitio" por landing.
//
// Los componentes Astro reciben `settings?: SiteSettings` como prop y
// calculan los valores EFECTIVOS con resolveSite(): default global de
// site.ts + override de los settings editados desde el dashboard.
//
// Así ningún componente cambia de comportamiento si la landing no tiene
// settings (todo sigue leyendo site.ts como antes) y el editor puede
// cambiar WhatsApp, teléfono, colores, CTA, menú y footer sin tocar
// código.
// ============================================================

import { site, PRIMARY_CTA, MENU_LINKS } from "../data/site";

export interface SiteColors {
  primary?: string;
  primaryDark?: string;
  accent?: string;
}

export interface SiteMenuLink {
  text: string;
  href: string;
}

export interface SiteAddress {
  street?: string;
  locality?: string;
  region?: string;
}

export interface SiteSettings {
  siteName?: string;
  phone?: string;
  whatsappNumber?: string;
  whatsappText?: string;
  email?: string;
  primaryCta?: string;
  colors?: SiteColors;
  menuLinks?: SiteMenuLink[];
  address?: SiteAddress;
}

export interface ResolvedSite {
  name: string;
  phone: string;
  email: string;
  whatsappNumber: string;
  whatsappText: string;
  whatsappHref: string;
  primaryCta: string;
  menuLinks: SiteMenuLink[];
  address: Required<SiteAddress>;
  theme: {
    primary: string;
    primaryDark: string;
    accent: string;
  };
}

/** Valores efectivos de la landing: site.ts (default) + override de settings. */
export function resolveSite(settings?: SiteSettings | null): ResolvedSite {
  const s = settings ?? {};

  const whatsappNumber = s.whatsappNumber ?? site.whatsappNumber;
  const whatsappText = s.whatsappText ?? site.whatsappText;

  return {
    name: s.siteName ?? site.name,
    phone: s.phone ?? site.phone,
    email: s.email ?? site.email,
    whatsappNumber,
    whatsappText,
    whatsappHref: `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappText)}`,
    primaryCta: s.primaryCta ?? PRIMARY_CTA,
    menuLinks: s.menuLinks && s.menuLinks.length > 0 ? s.menuLinks : MENU_LINKS,
    address: {
      street: s.address?.street ?? site.address.street,
      locality: s.address?.locality ?? site.address.locality,
      region: s.address?.region ?? site.address.region,
    },
    theme: {
      primary: s.colors?.primary ?? site.theme.primary,
      primaryDark: s.colors?.primaryDark ?? site.theme.primaryDark,
      accent: s.colors?.accent ?? site.theme.accent,
    },
  };
}
