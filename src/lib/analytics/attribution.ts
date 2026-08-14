// ============================================================
// Atribución — lógica pura (sin DOM), testeable con vitest.
// Concepto traducido del script de atribución por DOM cross-session.
// Spec: docs/analytics.md §2.1
// ============================================================

export const UTM_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 días

export interface ClickIds {
  gclid?: string; gbraid?: string; wbraid?: string;
  fbclid?: string; msclkid?: string; ttclid?: string;
  li_fat_id?: string; gad_source?: string;
  ctwa_clid?: string;  // SOLO server-side: llega en el webhook de WhatsApp (referral del 1er mensaje), no en el DOM
}

export interface Attribution {
  utm: { source?: string; medium?: string; campaign?: string; term?: string; content?: string };
  click_ids: ClickIds;
  channel?: string;    // google|bing|tiktok|linkedin|facebook|instagram|organic|social|direct
  medium?: string;     // cpc|organic|social|none
  landing_slug: string;
  ref_code?: string;
  first_seen?: number;
  last_touch?: number;
  event_id?: string;
  consent?: string;    // hook Consent Mode (ad_storage)
  // Meta signal: cookies first-party _fbc/_fbp que Meta planta. Su ausencia
  // rompe el matching browser→server de la CAPI (los eventos website llegan
  // sin deduplicar). Se leen en god.ts y se propagan hasta el server.
  fbc?: string;        // Meta click id (_fbc)
  fbp?: string;        // Meta browser id (_fbp)
  // Dominio del referrer (hostname). El usuario lo pidió explícitamente
  // ("de referrer poner lo del dom que tengo de donde viene"): hoy solo se
  // guarda el referrer crudo en page_view.payload; se persiste el dominio
  // en la atribución para reporting de adquisición.
  referrer?: string;   // hostname, ej. "google.com"
}

// 13 campos leídos del query string
const URL_FIELDS = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content",
  "gclid","gbraid","wbraid","fbclid","msclkid","ttclid","li_fat_id","gad_source"] as const;

/** 1. Captura del query string — el DOM es la fuente de verdad */
export function parseUrlParams(search: string): Partial<Attribution> {
  const p = new URLSearchParams(search);
  const utm: Attribution["utm"] = {};
  const click_ids: ClickIds = {};
  for (const f of URL_FIELDS) {
    const v = p.get(f);
    if (!v) continue;
    if (f.startsWith("utm_")) utm[f.replace("utm_", "") as keyof typeof utm] = v;
    else click_ids[f as keyof ClickIds] = v;
  }
  const out: Partial<Attribution> = {};
  if (Object.keys(utm).length) out.utm = utm;
  if (Object.keys(click_ids).length) out.click_ids = click_ids;
  return out;
}

/** 2. Mapeo clid → canal (Google te da gclid, no utm) */
export function mapClickIdToChannel(ids: ClickIds): string | undefined {
  if (ids.gclid || ids.gad_source) return "google";
  if (ids.msclkid) return "bing";
  if (ids.ttclid) return "tiktok";
  if (ids.li_fat_id) return "linkedin";
  return undefined;
}

/** 3. Mapeo referrer → canal (cuando no hay ads, el referrer cuenta la historia) */
export function mapReferrerToChannel(referrer: string): { channel: string; medium: string } | undefined {
  const r = referrer.toLowerCase();
  if (r.includes("google.")) return { channel: "google", medium: "organic" };
  if (r.includes("bing."))   return { channel: "bing", medium: "organic" };
  if (r.includes("facebook.") || r.includes("fb.com"))  return { channel: "facebook", medium: "social" };
  if (r.includes("instagram.")) return { channel: "instagram", medium: "social" };
  if (r.includes("linkedin."))   return { channel: "linkedin", medium: "social" };
  if (r.includes("t.co") || r.includes("twitter.")) return { channel: "twitter", medium: "social" };
  return undefined;
}

/** 4. Compone la atribución completa — el contrato DOM → cookie → server */
export function buildAttribution(input: {
  search: string; referrer: string; landingPath: string;
  existing?: Partial<Attribution>; consent?: string;
  fbc?: string; fbp?: string;
}): Attribution {
  const url = parseUrlParams(input.search);
  const clickIds = url.click_ids ?? {};
  const ref = mapReferrerToChannel(input.referrer);
  const channel =
    mapClickIdToChannel(clickIds) ??      // 1º: click id de ads (el más preciso)
    url.utm?.source ??                    // 2º: utm explícito
    ref?.channel ??                       // 3º: referrer
    "direct";
  const medium =
    clickIds.gclid || clickIds.msclkid || clickIds.ttclid || clickIds.li_fat_id ? "cpc"
    : url.utm?.medium ?? ref?.medium ?? "none";
  return {
    utm: url.utm ?? {},
    click_ids: clickIds,
    channel, medium,
    landing_slug: input.landingPath.replace(/^\/|\/$/g, "") || "home",
    ref_code: input.existing?.ref_code ?? genRefCode(),
    first_seen: input.existing?.first_seen ?? Date.now(),
    last_touch: Date.now(),
    event_id: input.existing?.event_id ?? genEventId(),
    consent: input.consent,
    // Meta _fbc/_fbp y dominio del referrer. Precedencia: la del DOM de hoy
    // (o la persistida si la captura de cookies la preservó) antes que la
    // existente en la cookie de atribución.
    fbc: input.fbc ?? input.existing?.fbc,
    fbp: input.fbp ?? input.existing?.fbp,
    referrer: referrerDomain(input.referrer) ?? input.existing?.referrer,
  };
}

/** 4b. Extrae el HOSTNAME de un referrer (el dominio "de donde viene"). */
export function referrerDomain(referrer: string): string | undefined {
  if (!referrer) return undefined;
  try {
    return new URL(referrer).hostname;
  } catch {
    return undefined;
  }
}

/** 5. ref_code: ata una conversión OFFLINE (WhatsApp/tel) al canal de origen */
const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin I/L/O/0/1 (legibilidad)
export function genRefCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += REF_CHARS.charAt(Math.floor(Math.random() * REF_CHARS.length));
    if (i === 2) code += "-";
  }
  return code;
}

/** 6. event_id: dedup universal (Meta + Google + nuestra tabla) */
export function genEventId(): string {
  return "a" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}
