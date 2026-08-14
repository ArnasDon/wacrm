// ============================================================
// trackEventSchema — validación de entrada para /api/events y
// /api/track. Reducido v8 (DAD §4): solo eventos SIN hogar.
// Los eventos nativos (message_sent/call_logged) viven en sus
// tablas; state_changed/score_changed solo los escribe RPC/trigger.
// Dedup hard por event_id (columna UNIQUE en tracking_events).
// ============================================================

import { z } from 'zod';

/**
 * Tipos aceptados por la API (reducido v8, DAD §4).
 *
 * /api/events es ANÓNIMO (solo rate limit), así que esta lista es la
 * superficie de escritura pública sobre `tracking_events`: todo tipo que
 * aparezca aquí lo puede insertar cualquiera. Por eso solo entra lo que un
 * cliente nuestro emite de verdad.
 *
 * Quién produce cada uno de los 7 tipos que llegan hoy a la tabla:
 *
 *   form_submit    → landing (lead-form.ts + las dos páginas de gracias)
 *   page_view      → god.js, vía sendPageView                    ← esta API
 *   whatsapp_click → /api/track (beacon GET, beaconSchema)
 *   phone_click    → /api/track
 *   scroll_depth   → /api/track
 *   ctwa_lead      → webhook de WhatsApp, server-side con service role
 *   state_changed  → RPC transition_deal (migraciones 049/058) y
 *                    /api/deals/[id]/reactivate
 *
 * `utm_recorded` e `identity_merged` estaban admitidos aquí y no los emite
 * NADA — ni cliente, ni servidor, ni migración. Eran dos tipos que cualquiera
 * podía insertar de forma anónima sin que ningún código los leyera nunca.
 * Fuera.
 *
 * El CHECK de la tabla (migración 047) sigue admitiendo 23 tipos y se deja
 * como está a propósito: su trabajo es atrapar erratas, no ser el catálogo, y
 * estrechar un CHECK en producción es de ida y difícil vuelta. Esta lista, que
 * es código, es la que manda para lo que entra desde fuera.
 */
export const EVENT_TYPES = [
  'form_submit',
  'ctwa_lead',
  'page_view',
  'whatsapp_click',
  'phone_click',
  'scroll_depth',
] as const;

export type TrackEventType = (typeof EVENT_TYPES)[number];

/** Atribución de cliente (parcial — el server no necesita todo) */
export const attributionInputSchema = z.object({
  utm: z
    .object({
      source: z.string().optional(),
      medium: z.string().optional(),
      campaign: z.string().optional(),
      term: z.string().optional(),
      content: z.string().optional(),
    })
    .optional(),
  click_ids: z
    .object({
      gclid: z.string().optional(),
      gbraid: z.string().optional(),
      wbraid: z.string().optional(),
      fbclid: z.string().optional(),
      msclkid: z.string().optional(),
      ttclid: z.string().optional(),
      li_fat_id: z.string().optional(),
      gad_source: z.string().optional(),
    })
    .optional(),
  channel: z.string().optional(),
  medium: z.string().optional(),
  landing_slug: z.string().optional(),
  ref_code: z.string().optional(),
  first_seen: z.number().optional(),
  last_touch: z.number().optional(),
  event_id: z.string().optional(),
  consent: z.string().optional(),
  visitor_id: z.string().optional(),
  // Loop de conversiones: Meta _fbc/_fbp (matching CAPI) y dominio del
  // referrer. Llegan en hidden inputs desde god.js.
  fbc: z.string().max(256).optional(),
  fbp: z.string().max(256).optional(),
  referrer: z.string().max(256).optional(),
});

/** Payload acotado: valores JSON simples, tamaño y número de claves limitados
 *  (antes: z.record(z.string(), z.unknown()) sin tope → DoS de almacenamiento
 *  con jsonb ilimitado desde endpoints anónimos). */
const MAX_PAYLOAD_KEYS = 24;
const MAX_PAYLOAD_KEY_LEN = 64;
const MAX_PAYLOAD_VALUE_LEN = 2000;
const MAX_PAYLOAD_SERIALIZED = 16_384; // 16 KB — holgado para form_submit, inútil para abuso

const payloadValueSchema = z.union([
  z.string().max(MAX_PAYLOAD_VALUE_LEN),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const payloadSchema = z
  .record(z.string().max(MAX_PAYLOAD_KEY_LEN), payloadValueSchema)
  .refine((v) => JSON.stringify(v).length <= MAX_PAYLOAD_SERIALIZED, {
    message: `payload exceeds ${MAX_PAYLOAD_SERIALIZED} bytes`,
  })
  .refine((v) => Object.keys(v).length <= MAX_PAYLOAD_KEYS, {
    message: `payload exceeds ${MAX_PAYLOAD_KEYS} keys`,
  })
  .optional();

/**
 * Teléfono en formato E.164 (`+5215512345678`) o dígitos nacionales
 * (`5215512345678`) — el ingest normaliza ambos. Rechaza basura
 * (letras, <7 dígitos, >15 dígitos) antes de que cree un lead.
 */
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$|^\d{7,15}$/, {
    message: 'phone must be E.164 (e.g. +5215512345678) or national digits',
  });

export const trackEventSchema = z.object({
  event_id: z.string().min(6).max(128),
  event_type: z.enum(EVENT_TYPES),
  attribution: attributionInputSchema.optional(),
  payload: payloadSchema,
  ref_code: z.string().optional(),
  landing_slug: z.string().optional(),
});

export type TrackEventInput = z.infer<typeof trackEventSchema>;

/** Beacon GET anónimo (/api/track) — clicks WhatsApp/tel + scroll */
export const beaconSchema = z.object({
  type: z.enum(['whatsapp', 'phone', 'scroll']),
  ref: z.string().optional(),
  landing: z.string().optional(),
  event_id: z.string().optional(),
  href: z.string().optional(),
  scrollPercent: z.number().min(0).max(100).optional(),
});
