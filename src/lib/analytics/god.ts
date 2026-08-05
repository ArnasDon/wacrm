// ============================================================
// Script de atribución (browser). Se bundlea a public/god.js
// en build. Atribución cross-session 90d.
// Spec: docs/analytics.md §2.2
// ============================================================
import { UTM_TTL_MS, genEventId, buildAttribution, type Attribution } from "./attribution";

/** Interfaz mínima del window que god.js toca (compat GTM + consent hook). */
interface GodWindow extends Window {
  dataLayer?: unknown[];
  getConsent?: (feature: string) => string;
  __WACRM_SITE_URL__?: string;
}

const W = window as GodWindow;

const KEY = (k: string) => `_exp_${k}`; // claves de expiración

/** localStorage con TTL 90d — sobrevive el cierre del navegador */
export function utmSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(KEY(key), String(Date.now() + UTM_TTL_MS));
    localStorage.setItem(key, value);
  } catch {}
}
export function utmGetItem(key: string): string | null {
  try {
    const exp = localStorage.getItem(KEY(key));
    if (exp && Date.now() > parseInt(exp, 10)) {
      localStorage.removeItem(key); localStorage.removeItem(KEY(key));
      return null;
    }
    return localStorage.getItem(key);
  } catch { return null; }
}

/** Cookie mirror — el server lee la atribución sin JS (path=/, 90d, SameSite=Lax) */
export function setCookieMirror(fields: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(fields)) {
    if (!v) continue;
    try { document.cookie = `${k}=${encodeURIComponent(v)};path=/;max-age=${90*24*60*60};SameSite=Lax`; } catch {}
  }
}

/** Cookie compuesta wacrm_attr (JSON) — first_seen/last_touch/landing/ref_code */
export function readAttrCookie(): Partial<Attribution> {
  try {
    const raw = document.cookie.split("; ").find(r => r.startsWith("wacrm_attr="));
    return raw ? JSON.parse(decodeURIComponent(raw.split("=")[1])) : {};
  } catch { return {}; }
}

export function writeAttrCookie(attr: Attribution): void {
  try {
    document.cookie = `wacrm_attr=${encodeURIComponent(JSON.stringify(attr))};path=/;max-age=${90*24*60*60};SameSite=Lax`;
  } catch {}
}

/** Identidad de visitante (inspiración Mautic device_id): uuid persistente
 *  en localStorage + cookie first-party 1 año. Permite unir visitas
 *  cross-session y reasignarlas al contacto al identificarse (merge). */
export function getVisitorId(): string {
  const COOKIE = "wacrm_visitor";
  const LS = "_wacrm_visitor";
  try {
    const ls = localStorage.getItem(LS);
    if (ls) { setCookieFirstParty(COOKIE, ls, 365); return ls; }
    const c = document.cookie.split("; ").find(r => r.startsWith(COOKIE + "="));
    if (c) { localStorage.setItem(LS, c.split("=")[1]); return c.split("=")[1]; }
  } catch {}
  const id = crypto.randomUUID?.() ?? genEventId();
  try { localStorage.setItem(LS, id); } catch {}
  setCookieFirstParty(COOKIE, id, 365);
  return id;
}
function setCookieFirstParty(name: string, value: string, days: number): void {
  try { document.cookie = `${name}=${value};path=/;max-age=${days*24*60*60};SameSite=Lax`; } catch {}
}

/** Rellena hidden inputs del formulario con la atribución (el viaje al server) */
export function fillHiddenInputs(form: HTMLFormElement, attr: Attribution): void {
  const set = (name: string, v?: string) => {
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (input && v) input.value = v;
  };
  set("utm_source", attr.utm.source); set("utm_medium", attr.utm.medium);
  set("utm_campaign", attr.utm.campaign); set("utm_term", attr.utm.term);
  set("utm_content", attr.utm.content);
  for (const [k, v] of Object.entries(attr.click_ids)) set(k, v);
  set("landing_slug", attr.landing_slug);
  set("ref_code", attr.ref_code);
  set("event_id", attr.event_id);
  set("channel", attr.channel); set("medium", attr.medium);
  set("visitor_id", getVisitorId());
}

/** Init idempotente: captura DOM → persiste → rellena forms → dataLayer page_view */
export function initAttribution(): void {
  const existing = readAttrCookie();
  const attr = buildAttribution({
    search: location.search,
    referrer: document.referrer,
    landingPath: location.pathname,
    existing,
    consent: W.getConsent?.("ad_storage") ?? "granted",
  });
  // persiste campos individuales (mirror) + cookie compuesta
  setCookieMirror({ ...attr.utm, ...attr.click_ids });
  writeAttrCookie(attr);
  utmSetItem("ref_code", attr.ref_code!);
  // hidden inputs ya presentes en el DOM
  document.querySelectorAll("form:not([data-no-track])").forEach((f) => {
    fillHiddenInputs(f as HTMLFormElement, attr);
  });
  // dataLayer page_view (compat GTM)
  W.dataLayer ??= [];
  W.dataLayer.push({ event: "page_view", ...attr, landing_slug: attr.landing_slug, event_id: attr.event_id });
}

/** Beacon de clicks (el ref_code viaja en el texto pre-rellenado del WhatsApp) */
export function wireClickBeacons(siteUrl: string): void {
  document.addEventListener("click", (e) => {
    const target = e.target as Element;
    const wa = target.closest<HTMLAnchorElement>('a[href*="wa.me"], a[href*="whatsapp.com"]');
    const tel = target.closest<HTMLAnchorElement>('a[href^="tel:"]');
    if (!wa && !tel) return;
    const attr = readAttrCookie();
    const type = wa ? "whatsapp" : "phone";
    (W.dataLayer ?? []).push({ event: wa ? "whatsapp_click" : "phone_click", href: wa?.href ?? tel?.href, event_id: attr.event_id });
    if (navigator.sendBeacon) {
      const qs = new URLSearchParams({ type, ref: attr.ref_code ?? "", landing: location.pathname, event_id: attr.event_id ?? "" });
      navigator.sendBeacon(`${siteUrl}/api/track?${qs}`, "");
    }
  }, true);
}

// God entry — se ejecuta en cada página que carga /god.js
(function main(): void {
  try {
    const siteUrl = W.__WACRM_SITE_URL__ ?? location.origin;
    initAttribution();
    wireClickBeacons(siteUrl);
  } catch {}
})();
