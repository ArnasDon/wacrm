/**
 * Industry verticals — per-company starter kits.
 *
 * A company (`accounts` row) carries `industry_vertical` (migration
 * 105). This module is the code-defined registry that says, for each
 * vertical, what "the right CRM setup" is: which contact custom fields,
 * which pipeline, which starter flows/automations, which knowledge-base
 * scaffolds, which Google-Sheets events, and a couple of account
 * settings.
 *
 * Applying a kit is done by `src/lib/verticals/seed.ts` (called from
 * `POST /api/admin/companies/[id]/apply-vertical`, platform-admin only).
 * It is idempotent — anything that already exists by name is left alone.
 *
 * `generic` is the default and is a NO-OP kit: it exists so the seeder
 * has something to point at, but seeding it changes nothing (the lazy
 * client-side default-pipeline seed in `pipelines/page.tsx` still
 * handles first-run for generic accounts).
 *
 * Growing the list = add one `VerticalDefinition` entry (+ optional
 * `verticals` tags on nav/settings items). Add the matching value to
 * the `industry_vertical` CHECK constraint in a new migration.
 */

export type VerticalSlug = 'generic' | 'hotel'

export const VERTICAL_SLUGS: readonly VerticalSlug[] = ['generic', 'hotel'] as const

export interface VerticalPipelineStage {
  name: string
  color: string
  is_won?: boolean
}

export interface VerticalDefinition {
  slug: VerticalSlug
  /** Human label for the /admin selector and the read-only Settings line. */
  label: string
  /** Contact custom-field names to create (always `field_type: 'text'`). */
  customFields: string[]
  /** Catalog category names to create (migration 106). */
  productCategories: string[]
  /** Pipeline to create when the account has none of this name yet.
   *  `null` = don't create one (generic relies on the lazy client seed). */
  pipeline: { name: string; stages: VerticalPipelineStage[] } | null
  /** Flow templates (slugs in `src/lib/flows/templates.ts`) cloned as drafts. */
  flowTemplateSlugs: string[]
  /** Automation templates (slugs in `src/lib/automations/templates.ts`) cloned inactive. */
  automationTemplateSlugs: string[]
  /** Knowledge-base docs seeded with `[[placeholder]]`s for the owner to fill. */
  knowledgeDocs: { title: string; content: string }[]
  /** Events to pre-select on `google_sheets_config.events` (only if a row exists). */
  googleSheetsEvents: string[]
  /** Account-level scalar settings to apply. */
  accountSettings: { catalog_delivery_mode?: 'digital' | 'pdf' | 'photos' }
  /** Pre-fill `ai_configs.system_prompt` ONLY when it is currently empty. */
  aiSystemPromptScaffold?: string
  /** Sidebar `labelKey`s hidden for this vertical (absent = show all). */
  hiddenNavKeys?: string[]
  /** Settings section ids hidden for this vertical. */
  hiddenSettingsSections?: string[]
}

const GENERIC: VerticalDefinition = {
  slug: 'generic',
  label: 'Genérico',
  customFields: [],
  productCategories: [],
  pipeline: null,
  flowTemplateSlugs: [],
  automationTemplateSlugs: [],
  knowledgeDocs: [],
  googleSheetsEvents: [],
  accountSettings: {},
}

const HOTEL_TARIFAS_DOC = `TARIFAS DE HABITACIONES
- Lunes a jueves: tarifa económica (el precio base de cada habitación en el catálogo).
- Viernes, sábado y domingo: tarifa alta.
- Si la estancia cruza días de semana y fin de semana, cobra cada noche a su tarifa correspondiente.
- Tarifa en pareja / paquete romántico: [[precio pareja]].
- Persona adicional: [[Q__ por noche]].
- Check-in: [[15:00]] · Check-out: [[12:00]].
- Anticipo para confirmar la reserva: [[50%]].

SPA
- [[servicio]]: [[precio]] · [[duración]]
- ...

ACTIVIDADES
- [[actividad]]: [[precio]] · [[duración]]
- ...

PAQUETES ACTIVOS
- [[nombre del paquete]]: incluye [[...]] · entre semana [[Q__]] · fin de semana [[Q__]]
- ...`

const HOTEL_POLITICAS_DOC = `POLÍTICAS Y HORARIOS
- Horario de recepción: [[...]].
- Política de cancelación: [[...]].
- Mascotas: [[permitidas / no permitidas]].
- Formas de pago aceptadas: [[...]].
- Cómo llegar: [[dirección / referencia]].

IMPORTANTE PARA LA IA
- Puedes informar tarifas y responder dudas generales.
- Pide siempre: fecha de entrada, fecha de salida, número de personas, si vienen en pareja, y si quieren spa/actividades/paquete.
- NUNCA confirmes que una habitación está disponible ni cierres la reserva.
- Deja claro que un asesor de recepción confirmará la disponibilidad y los datos, y transfiere la conversación.`

const HOTEL_AI_PROMPT = `Eres el asistente de un hotel. Atiendes a huéspedes por WhatsApp, Instagram y Facebook.

Qué haces:
- Informas tarifas de habitaciones, spa, actividades y paquetes usando la base de conocimiento (nunca inventes un precio).
- Cuando alguien quiere reservar, pides: fecha de entrada, fecha de salida, número de personas, si vienen en pareja, y si quieren spa/actividades/paquete. Calculas el total noche por noche según las TARIFAS.
- Resumes esos datos y transfieres a un asesor de recepción para que confirme disponibilidad.

Qué NO haces:
- No confirmas disponibilidad de habitaciones ("hay lugar el sábado") — eso lo valida un humano.
- No cierras la reserva ni cobras anticipos.
- No inventas servicios, precios ni horarios que no estén en la base de conocimiento.

Tono: cálido, breve, servicial.`

const HOTEL: VerticalDefinition = {
  slug: 'hotel',
  label: 'Hotel',
  customFields: [
    'Fecha de entrada',
    'Fecha de salida',
    'Noches',
    'Habitación',
    'Ocupación',
    'Huéspedes',
    'Paquete',
    'Servicios adicionales',
  ],
  productCategories: ['Habitaciones', 'Spa', 'Actividades al aire libre', 'Paquetes'],
  pipeline: {
    name: 'Reservas',
    stages: [
      { name: 'Consulta', color: '#3b82f6' },
      { name: 'Cotización enviada', color: '#eab308' },
      { name: 'Confirmada', color: '#f97316' },
      { name: 'Hospedado', color: '#8b5cf6' },
      { name: 'Check-out', color: '#22c55e', is_won: true },
    ],
  },
  flowTemplateSlugs: ['hotel_welcome'],
  automationTemplateSlugs: [],
  knowledgeDocs: [
    { title: 'Tarifas', content: HOTEL_TARIFAS_DOC },
    { title: 'Políticas y horarios', content: HOTEL_POLITICAS_DOC },
  ],
  googleSheetsEvents: ['deal.won', 'contact.brief_ready', 'quote.created'],
  accountSettings: { catalog_delivery_mode: 'photos' },
  aiSystemPromptScaffold: HOTEL_AI_PROMPT,
}

const VERTICALS: Record<VerticalSlug, VerticalDefinition> = {
  generic: GENERIC,
  hotel: HOTEL,
}

export function getVertical(slug: string): VerticalDefinition | null {
  return (VERTICALS as Record<string, VerticalDefinition>)[slug] ?? null
}

export function listVerticals(): VerticalDefinition[] {
  return VERTICAL_SLUGS.map((s) => VERTICALS[s])
}

export function isVerticalSlug(v: unknown): v is VerticalSlug {
  return typeof v === 'string' && (VERTICAL_SLUGS as readonly string[]).includes(v)
}

/** Sidebar `labelKey`s hidden for a vertical (empty for unknown/generic). */
export function hiddenNavKeysFor(slug: string): string[] {
  return getVertical(slug)?.hiddenNavKeys ?? []
}

/** Settings section ids hidden for a vertical. */
export function hiddenSettingsSectionsFor(slug: string): string[] {
  return getVertical(slug)?.hiddenSettingsSections ?? []
}
