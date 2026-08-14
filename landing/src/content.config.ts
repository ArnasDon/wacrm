// ============================================================
// content.config.ts — Content Collections de landings (skill §2.5).
//
// Cada landing es un JSON en src/data/landings/<slug>.json:
//   {
//     "title": "SEO title",
//     "description": "SEO meta description",
//     "blocks": [ { "type": "hero-video", "data": { ... } }, ... ]
//   }
//
// El schema valida en BUILD: si el editor guarda un JSON mal formado, el
// build falla señalando exactamente qué bloque y qué campo falla — no se
// rompe la página en producción en silencio.
//
// Convención de tipos: cada `type` de bloque mapea 1:1 a un componente en
// src/components/sections/<Type>.astro y su `data` son las props del
// componente (todas opcionales: el componente tiene defaults = valores
// actuales, así que un JSON mínimo funciona).
// ============================================================

import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";
import { fileURLToPath } from "node:url";

// ── Tipos de bloque ────────────────────────────────────────────
const heroVideo = z.object({
  videoId: z.string().optional(),
  desktopVideoId: z.string().optional(),
  thumbMobile: z.string().optional(),
  thumbDesktop: z.string().optional(),
  badge: z.string().optional(),
  displayTitle: z.string().optional(),
  subtitle: z.string().optional(),
});

const heroFakeH1 = z.object({
  badge: z.string().optional(),
  displayTitle: z.string().optional(),
  subtitle: z.string().optional(),
});

const heroCentered = z.object({
  badge: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
});

const socialProof = z.object({
  stats: z.array(z.object({ num: z.string(), label: z.string() })).optional(),
});

const scroller = z.object({
  items: z.array(z.string()).optional(),
  speed: z.enum(["fast", "normal", "slow"]).optional(),
  title: z.string().optional(),
});

const scrollerCards = z.object({
  title: z.string().optional(),
  heading: z.string().optional(),
  subtitle: z.string().optional(),
  speed: z.enum(["fast", "normal", "slow"]).optional(),
  cards: z
    .array(
      z.object({
        name: z.string(),
        meta: z.string(),
        img: z.string(),
        href: z.string().optional(),
      }),
    )
    .optional(),
});

const features = z.object({
  features: z
    .array(z.object({ icon: z.string(), title: z.string(), text: z.string() }))
    .optional(),
});

const video = z.object({
  id: z.string().optional(),
  desktopId: z.string().optional(),
  /** Default: vertical. "horizontal" solo cuando la sección lo necesita (VSL). */
  ratio: z.enum(["auto", "vertical", "horizontal"]).optional(),
  title: z.string().optional(),
  text: z.string().optional(),
  videoPosition: z.enum(["left", "right"]).optional(),
});

const leadSection = z.object({
  id: z.string().optional(),
  formId: z.string().optional(),
  heading: z.string().optional(),
  sub: z.string().optional(),
  dark: z.boolean().optional(),
});

const specialties = z.object({
  heading: z.string().optional(),
  sub: z.string().optional(),
  services: z
    .array(z.object({ name: z.string(), desc: z.string(), price: z.string() }))
    .optional(),
});

const pricingTable = z.object({
  rows: z
    .array(z.object({ name: z.string(), price: z.string(), category: z.boolean().optional() }))
    .optional(),
});

const comparison = z.object({
  title: z.string().optional(),
  cols: z
    .array(z.object({ head: z.string(), good: z.boolean(), items: z.array(z.string()) }))
    .optional(),
});

const dataTable = z.object({
  title: z.string().optional(),
  head: z.array(z.string()).optional(),
  rows: z.array(z.array(z.string())).optional(),
});

const videoTestimonials = z.object({
  items: z
    .array(z.object({ id: z.string(), name: z.string(), quote: z.string() }))
    .optional(),
});

const reviews = z.object({
  reviews: z
    .array(z.object({ name: z.string(), text: z.string(), rating: z.number() }))
    .optional(),
});

const gallery = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  /** URLs de imágenes (hoy picsum placeholder). Reemplazar por /landing/gallery-N.webp */
  images: z.array(z.string()).optional(),
});

const howItWorks = z.object({
  heading: z.string().optional(),
  steps: z.array(z.object({ title: z.string(), text: z.string() })).optional(),
});

const team = z.object({
  team: z
    .array(z.object({ name: z.string(), role: z.string(), bio: z.string(), img: z.string() }))
    .optional(),
});

const about = z.object({
  heading: z.string().optional(),
  name: z.string().optional(),
  jobTitle: z.string().optional(),
  bio: z.string().optional(),
  knowsAbout: z.array(z.string()).optional(),
  statNum: z.string().optional(),
  statLabel: z.string().optional(),
  statText: z.string().optional(),
});

const textSection = z.object({
  title: z.string().optional(),
  text: z.string().optional(),
  image: z.string().optional(),
  imagePosition: z.enum(["left", "right"]).optional(),
  bg: z.enum(["white", "secondary"]).optional(),
});

const leadMagnet = z.object({
  label: z.string().optional(),
  title: z.string().optional(),
  text: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  meta: z.array(z.string()).optional(),
  cover: z.string().optional(),
  cta: z.string().optional(),
  thankYou: z.string().optional(),
});

const faq = z.object({
  heading: z.string().optional(),
  faq: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
});

const relatedPages = z.object({
  pages: z
    .array(z.object({ title: z.string(), text: z.string(), href: z.string() }))
    .optional(),
});

const divider = z.object({
  margin: z.enum(["sm", "md", "lg"]).optional(),
});

const cta = z.object({
  title: z.string().optional(),
  text: z.string().optional(),
});

const thankYou = z.object({
  icon: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
  waCta: z.string().optional(),
  backText: z.string().optional(),
  backHref: z.string().optional(),
});

const thankYouDownload = z.object({
  icon: z.string().optional(),
  heading: z.string().optional(),
  text: z.string().optional(),
  downloadCta: z.string().optional(),
  downloadName: z.string().optional(),
  pdfHref: z.string().optional(),
  waCta: z.string().optional(),
  backText: z.string().optional(),
  backHref: z.string().optional(),
});

// ── Ajustes del sitio (por landing) ────────────────────────────
// Override opcional de los defaults globales de src/data/site.ts.
// Cada campo es opcional: si falta, site-context.ts resuelve el valor
// global. El editor del dashboard edita esto en "Ajustes del sitio".
const siteSettings = z.object({
  siteName: z.string().optional(),
  phone: z.string().optional(),
  whatsappNumber: z.string().optional(),
  whatsappText: z.string().optional(),
  email: z.string().optional(),
  primaryCta: z.string().optional(),
  colors: z
    .object({
      primary: z.string().optional(),
      primaryDark: z.string().optional(),
      accent: z.string().optional(),
    })
    .optional(),
  menuLinks: z
    .array(z.object({ text: z.string(), href: z.string() }))
    .optional(),
  address: z
    .object({
      street: z.string().optional(),
      locality: z.string().optional(),
      region: z.string().optional(),
    })
    .optional(),
});

// ── Documento de landing ───────────────────────────────────────
const landing = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/data/landings" }),
  schema: z.object({
    /** SEO title (también visible en el <title>) */
    title: z.string(),
    /** SEO meta description */
    description: z.string(),
    /** Ajustes del sitio (whatsapp, colores, menú, footer) — opcional. */
    settings: siteSettings.optional(),
    /** Bloques de la página, en orden de renderizado */
    blocks: z.array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("hero-video"), data: heroVideo }),
        z.object({ type: z.literal("hero-fake-h1"), data: heroFakeH1 }),
        z.object({ type: z.literal("hero-centered"), data: heroCentered }),
        z.object({ type: z.literal("social-proof"), data: socialProof }),
        z.object({ type: z.literal("scroller"), data: scroller }),
        z.object({ type: z.literal("scroller-cards"), data: scrollerCards }),
        z.object({ type: z.literal("features"), data: features }),
        z.object({ type: z.literal("video"), data: video }),
        z.object({ type: z.literal("lead-section"), data: leadSection }),
        z.object({ type: z.literal("specialties"), data: specialties }),
        z.object({ type: z.literal("pricing-table"), data: pricingTable }),
        z.object({ type: z.literal("comparison"), data: comparison }),
        z.object({ type: z.literal("data-table"), data: dataTable }),
        z.object({ type: z.literal("video-testimonials"), data: videoTestimonials }),
        z.object({ type: z.literal("reviews"), data: reviews }),
        z.object({ type: z.literal("gallery"), data: gallery }),
        z.object({ type: z.literal("how-it-works"), data: howItWorks }),
        z.object({ type: z.literal("team"), data: team }),
        z.object({ type: z.literal("about"), data: about }),
        z.object({ type: z.literal("text-section"), data: textSection }),
        z.object({ type: z.literal("lead-magnet"), data: leadMagnet }),
        z.object({ type: z.literal("faq"), data: faq }),
        z.object({ type: z.literal("related-pages"), data: relatedPages }),
        z.object({ type: z.literal("divider"), data: divider }),
        z.object({ type: z.literal("cta"), data: cta }),
        z.object({ type: z.literal("thank-you"), data: thankYou }),
        z.object({ type: z.literal("thank-you-download"), data: thankYouDownload }),
      ]),
    ),
  }),
});

export const collections = { landing };