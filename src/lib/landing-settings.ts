// ============================================================
// landing-settings.ts — "Ajustes del sitio" por landing.
//
// Datos PUROS (importables desde client components del dashboard).
// El schema zod de la Content Collection de Astro
// (landing/src/content.config.ts) es la autoridad de validación en
// build; aquí solo se describe la forma para que el editor la edite.
//
// Cada campo es OPCIONAL: si no está, la landing usa el default global
// de landing/src/data/site.ts (site-context.ts resuelve los efectivos).
// ============================================================

export interface LandingColors {
  primary?: string;
  primaryDark?: string;
  accent?: string;
}

export interface LandingMenuLink {
  text: string;
  href: string;
}

export interface LandingAddress {
  street?: string;
  locality?: string;
  region?: string;
}

export interface LandingSettings {
  /** Nombre del negocio (marca del header/footer). */
  siteName?: string;
  /** Teléfono visible (formato libre). */
  phone?: string;
  /** Número de WhatsApp (solo dígitos, con país: 52155…). */
  whatsappNumber?: string;
  /** Mensaje pre-rellenado del enlace wa.me. */
  whatsappText?: string;
  /** Email de contacto. */
  email?: string;
  /** Texto del botón principal (CTA global). */
  primaryCta?: string;
  /** Colores de marca. */
  colors?: LandingColors;
  /** Links del menú de navegación. */
  menuLinks?: LandingMenuLink[];
  /** Datos del footer. */
  address?: LandingAddress;
}

/** URL de imagen ya rellenada por el media picker — no forma parte del
 *  esquema, es solo un marcador para campos imagen del editor. */
export const LANDING_IMAGE_FIELDS = [
  'image',
  'img',
  'src',
  'cover',
  'thumbMobile',
  'thumbDesktop',
] as const;

/** Catálogo de formularios que la landing sabe renderizar. El campo
 *  `formId` de los bloques de captación elige entre estos ids. */
export const LANDING_FORMS: { id: string; label: string }[] = [
  { id: 'contact', label: 'Formulario de contacto (envía a WhatsApp)' },
];