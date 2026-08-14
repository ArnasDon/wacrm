// ============================================================
// landing-block-types.ts — catálogo de bloques para el page editor.
//
// Datos PUROS, sin fs ni server-only: este archivo se importa desde client
// components del dashboard. El schema zod de la Content Collection de Astro
// (landing/src/content.config.ts) es la autoridad de validación en build;
// aquí solo se describe el catálogo para que el editor pueda listar y crear
// bloques. Si un tipo no está en el schema de Astro, el build de la landing
// lo rechaza — el editor no puede inventar estructura.
//
// `defaultData`: template con el que nace un bloque nuevo. Los campos son
// strings vacíos (o arrays vacíos) válidos contra el schema → el inspector
// los muestra editables de inmediato y el build no falla al guardar.
// Campos boolean/enum (dark, imagePosition, bg, margin, videoPosition) se
// omiten: el componente Astro tiene defaults y el inspector los guardaría
// como string rompiendo el build.
// ============================================================

export interface BlockType {
  type: string;
  label: string;
  icon: string;
  defaultData: Record<string, unknown>;
}

export const BLOCK_TYPES: BlockType[] = [
  {
    type: 'hero-video',
    label: 'Hero con video',
    icon: '▶️',
    defaultData: { videoId: '', badge: '', displayTitle: '', subtitle: '' },
  },
  {
    type: 'hero-fake-h1',
    label: 'Hero titular',
    icon: '🔠',
    defaultData: { badge: '', displayTitle: '', subtitle: '' },
  },
  {
    type: 'hero-centered',
    label: 'Hero centrado',
    icon: '🎯',
    defaultData: { badge: '', title: '', subtitle: '' },
  },
  {
    type: 'social-proof',
    label: 'Cifras de respaldo',
    icon: '📊',
    defaultData: { stats: [] },
  },
  {
    type: 'scroller',
    label: 'Marquesina de logos',
    icon: '🎞️',
    defaultData: { items: [], speed: 'normal', title: '' },
  },
  {
    type: 'scroller-cards',
    label: 'Scroller de tarjetas',
    icon: '🃏',
    defaultData: { title: '', heading: '', subtitle: '', cards: [] },
  },
  {
    type: 'features',
    label: 'Beneficios',
    icon: '✨',
    defaultData: { features: [] },
  },
  {
    type: 'video',
    label: 'Video + contenido',
    icon: '🎬',
    defaultData: { id: '', ratio: 'vertical', title: '', text: '' },
  },
  {
    type: 'lead-section',
    label: 'Formulario de captación',
    icon: '📝',
    defaultData: { formId: '', heading: '', sub: '' },
  },
  {
    type: 'specialties',
    label: 'Tratamientos y precios',
    icon: '🩺',
    defaultData: { heading: '', services: [] },
  },
  {
    type: 'pricing-table',
    label: 'Tabla de precios',
    icon: '💰',
    defaultData: { rows: [] },
  },
  {
    type: 'comparison',
    label: 'Comparativa',
    icon: '⚖️',
    defaultData: { title: '', cols: [] },
  },
  {
    type: 'data-table',
    label: 'Tabla de datos',
    icon: '📋',
    defaultData: { title: '', head: [], rows: [] },
  },
  {
    type: 'video-testimonials',
    label: 'Testimonios en video',
    icon: '🗣️',
    defaultData: { items: [] },
  },
  {
    type: 'reviews',
    label: 'Reseñas',
    icon: '⭐',
    defaultData: { reviews: [] },
  },
  {
    type: 'gallery',
    label: 'Galería',
    icon: '🖼️',
    defaultData: { title: '', images: [] },
  },
  {
    type: 'how-it-works',
    label: 'Proceso',
    icon: '🪜',
    defaultData: { heading: '', steps: [] },
  },
  {
    type: 'team',
    label: 'Equipo',
    icon: '👥',
    defaultData: { team: [] },
  },
  {
    type: 'about',
    label: 'Quién te atiende',
    icon: '👩‍⚕️',
    defaultData: { heading: '', name: '', jobTitle: '', bio: '' },
  },
  {
    type: 'text-section',
    label: 'Texto con imagen',
    icon: '📄',
    defaultData: { title: '', text: '', image: '' },
  },
  {
    type: 'lead-magnet',
    label: 'Imán de leads',
    icon: '📚',
    defaultData: { label: '', title: '', text: '', cta: '', thankYou: '' },
  },
  {
    type: 'faq',
    label: 'Preguntas frecuentes',
    icon: '❓',
    defaultData: { heading: '', faq: [] },
  },
  {
    type: 'related-pages',
    label: 'Páginas relacionadas',
    icon: '🔗',
    defaultData: { pages: [] },
  },
  {
    type: 'divider',
    label: 'Separador',
    icon: '➖',
    defaultData: {},
  },
  {
    type: 'cta',
    label: 'Cierre (CTA)',
    icon: '🚀',
    defaultData: { title: '', text: '' },
  },
  {
    type: 'thank-you',
    label: 'Confirmación',
    icon: '✅',
    defaultData: { icon: '', heading: '', text: '', waCta: '', backText: '', backHref: '' },
  },
];

/** Slugs reservados que no se pueden borrar ni renombrar (páginas del núcleo). */
export const RESERVED_SLUGS = ['home', 'thank-you', 'thank-you-download'];

/**
 * URL pública de una landing para el preview (y para mostrarla en el editor).
 *
 * - Sin NEXT_PUBLIC_LANDING_URL (producción): URLs canónicas de Next, que
 *   resuelven por rewrites de next.config.ts — "/" para home (raíz = landing),
 *   "/thank-you" y "/thank-you-download" (rewrites existentes), y
 *   "/landing/<slug>" para páginas nuevas (rewrite /landing/:slug).
 * - Con NEXT_PUBLIC_LANDING_URL (dev server de Astro, ej. http://localhost:4321):
 *   se usa esa base con el slug — el dev server sirve /landing/<slug> al
 *   instante con HMR.
 */
export function previewUrl(slug: string): string {
  const devServerUrl = process.env.NEXT_PUBLIC_LANDING_URL;
  if (typeof devServerUrl === 'string' && devServerUrl.length > 0) {
    const base = devServerUrl.replace(/\/+$/, '');
    return slug === 'home' ? `${base}/` : `${base}/${slug}`;
  }
  if (slug === 'home') return '/';
  if (slug === 'thank-you') return '/thank-you';
  if (slug === 'thank-you-download') return '/thank-you-download';
  return `/landing/${slug}`;
}