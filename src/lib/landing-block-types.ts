// ============================================================
// landing-block-types.ts — catálogo de bloques para el page editor.
//
// Datos PUROS, sin fs ni server-only: este archivo se importa desde client
// components del dashboard. El schema zod de la Content Collection de Astro
// (landing/src/content.config.ts) es la autoridad de validación en build;
// aquí solo se describe el catálogo para que el editor pueda listar y crear
// bloques. Si un tipo no está en el schema de Astro, el build de la landing
// lo rechaza — el editor no puede inventar estructura.
// ============================================================

export const BLOCK_TYPES = [
  { type: 'hero-video', label: 'Hero con video', icon: '▶️' },
  { type: 'hero-fake-h1', label: 'Hero titular', icon: '🔠' },
  { type: 'hero-centered', label: 'Hero centrado', icon: '🎯' },
  { type: 'social-proof', label: 'Cifras de respaldo', icon: '📊' },
  { type: 'scroller', label: 'Marquesina de logos', icon: '🎞️' },
  { type: 'scroller-cards', label: 'Scroller de tarjetas', icon: '🃏' },
  { type: 'features', label: 'Beneficios', icon: '✨' },
  { type: 'video', label: 'Video + contenido', icon: '🎬' },
  { type: 'lead-section', label: 'Formulario de captación', icon: '📝' },
  { type: 'specialties', label: 'Tratamientos y precios', icon: '🩺' },
  { type: 'pricing-table', label: 'Tabla de precios', icon: '💰' },
  { type: 'comparison', label: 'Comparativa', icon: '⚖️' },
  { type: 'data-table', label: 'Tabla de datos', icon: '📋' },
  { type: 'video-testimonials', label: 'Testimonios en video', icon: '🗣️' },
  { type: 'reviews', label: 'Reseñas', icon: '⭐' },
  { type: 'gallery', label: 'Galería', icon: '🖼️' },
  { type: 'how-it-works', label: 'Proceso', icon: '🪜' },
  { type: 'team', label: 'Equipo', icon: '👥' },
  { type: 'about', label: 'Quién te atiende', icon: '👩⚕️' },
  { type: 'text-section', label: 'Texto con imagen', icon: '📄' },
  { type: 'lead-magnet', label: 'Imán de leads', icon: '📚' },
  { type: 'faq', label: 'Preguntas frecuentes', icon: '❓' },
  { type: 'related-pages', label: 'Páginas relacionadas', icon: '🔗' },
  { type: 'divider', label: 'Separador', icon: '➖' },
  { type: 'cta', label: 'Cierre (CTA)', icon: '🚀' },
  { type: 'thank-you', label: 'Confirmación', icon: '✅' },
] as const;

/** Slugs reservados que no se pueden borrar ni renombrar (páginas del núcleo). */
export const RESERVED_SLUGS = ['home', 'thank-you', 'thank-you-download'];