// ============================================================
// trackEventSchema — validación de entrada para /api/events y
// /api/track. Reducido v8 (DAD §4): solo eventos SIN hogar.
// Los eventos nativos (message_sent/call_logged) viven en sus
// tablas; state_changed/score_changed solo los escribe RPC/trigger.
// Dedup hard por event_id (columna UNIQUE en tracking_events).
// ============================================================

import { z } from "zod";

/** Tipos aceptados por la API (reducido v8, DAD §4) */
export const EVENT_TYPES = [
  "form_submit",
  "ctwa_lead",
  "page_view",
  "whatsapp_click",
  "phone_click",
  "scroll_depth",
  "utm_recorded",
  "identity_merged",
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
});

/** Payload libre pero acotado (el server no guarda lo que no entiende) */
export const payloadSchema = z.record(z.string(), z.unknown()).optional();

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
  type: z.enum(["whatsapp", "phone", "scroll"]),
  ref: z.string().optional(),
  landing: z.string().optional(),
  event_id: z.string().optional(),
  href: z.string().optional(),
  scrollPercent: z.number().min(0).max(100).optional(),
});
