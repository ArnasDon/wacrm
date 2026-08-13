// ============================================================
// Script de atribución (browser). Se bundlea a public/god.js
// en build. Atribución cross-session 90d.
// Spec: docs/analytics.md §2.2
// ============================================================
import { UTM_TTL_MS, genEventId, buildAttribution, type Attribution } from "./attribution";

/** Interfaz mínima del window que god.js toca (compat GTM + consent hook). */
interface YTPlayerCtor {
  new (el: Element, opts: Record<string, unknown>): unknown;
}
interface GodWindow extends Window {
  dataLayer?: unknown[];
  getConsent?: (feature: string) => string;
  __WACRM_SITE_URL__?: string;
  /** API de YouTube, presente solo tras cargarla bajo demanda. */
  YT?: { Player: YTPlayerCtor };
  onYouTubeIframeAPIReady?: () => void;
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
    // `[name="…"]` y no `input[name="…"]`: con el selector viejo un campo que
    // fuera <textarea> o <select> no se encontraba y viajaba vacío. Misma
    // familia de bug que el que ya apareció en LeadForm.astro.
    const input = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
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

  // Y persistirlo. Antes solo iba al dataLayer, así que `tracking_events` no
  // tenía una sola fila de visita: sin ellas no hay primera columna de embudo
  // ni tasa de conversión de la landing. El tipo `page_view` ya estaba
  // declarado en el CHECK de la tabla (migración 047), esperando.
  //
  // sendBeacon y no fetch: no debe retrasar la carga ni competir con el LCP,
  // y sobrevive a que el usuario navegue fuera inmediatamente.
  sendPageView(attr);
}

/**
 * `page_view` a /api/events. Su `event_id` es propio y distinto del de la
 * atribución: ese identifica la SESIÓN de atribución y lo reutiliza el
 * form_submit para deduplicar el lead. Compartirlo haría que el UNIQUE de
 * `event_id` descartara en silencio el envío del formulario, que es el evento
 * que de verdad importa.
 */
function sendPageView(attr: Attribution): void {
  try {
    const body = JSON.stringify({
      event_id: `pv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      event_type: "page_view",
      // visitor_id se compone AQUÍ y no dentro de `attr`: `attr` es lo que se
      // persiste en la cookie de atribución, y el visitante ya tiene su propia
      // cookie de un año — duplicarlo sería dos fuentes de verdad para el
      // mismo dato. Es el mismo sitio donde lo añade lead-form.ts al enviar.
      //
      // Sin esto la visita se guarda anónima y no hay forma de unirla con el
      // form_submit que llega después: el embudo de /reports puede contar
      // visitas y leads, pero no decir que ESTA visita se convirtió en ESTE
      // lead. El campo ya estaba admitido por attributionInputSchema.
      attribution: { ...attr, visitor_id: getVisitorId() },
      ref_code: attr.ref_code,
      landing_slug: attr.landing_slug,
      payload: { path: location.pathname, referrer: document.referrer || undefined },
    });
    const url = `${location.origin}/api/events`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      return;
    }
    // Navegadores sin sendBeacon: fetch en segundo plano, sin bloquear.
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {}
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


// ============================================================
// YouTube diferido — portado de adwebcrm-theme/assets/god.js §1.
//
// El iframe no existe hasta el clic. Se usa la API de YouTube (YT.Player)
// cargada bajo demanda, no un iframe suelto, para poder controlar el
// reproductor y arrancar la reproducción sin un segundo gesto.
//
// Dos ids por vídeo: `data-video-id` es el VERTICAL (móvil) y
// `data-desktop-video-id` el horizontal. Si el segundo falta, se reutiliza el
// vertical — la regla es "vertical siempre salvo que haya versión horizontal".
// La elección se hace EN EL CLIC, no al cargar, para que girar el móvil no
// sirva el vídeo equivocado.
// ============================================================

const ytPlayers = new WeakMap<Element, unknown>();
let ytApiPromise: Promise<void> | undefined;

function loadYTApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve) => {
    if (W.YT?.Player) return resolve();
    const previous = W.onYouTubeIframeAPIReady;
    W.onYouTubeIframeAPIReady = () => {
      if (typeof previous === "function") { try { previous(); } catch {} }
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    document.head.appendChild(s);
  });
  return ytApiPromise;
}

export function wireYouTubeFacades(): void {
  document.addEventListener("click", (e) => {
    const target = e.target as Element | null;
    const wrap = target?.closest<HTMLElement>(".youtube-video");
    const btn = target?.closest(".play-button");
    // Hacen falta LOS DOS: sin exigir el botón, cualquier clic dentro del
    // bloque arrancaría el vídeo.
    if (!wrap || !btn) return;

    const isMobile = window.matchMedia("(max-width:767px)").matches;
    const videoId = isMobile
      ? wrap.dataset.videoId
      : wrap.dataset.desktopVideoId || wrap.dataset.videoId;

    if (!videoId || ytPlayers.has(wrap)) return;

    // 1) Quitar primero lo que se va a borrar: una sola pasada de layout.
    wrap.querySelector("picture")?.remove();
    btn.remove();
    wrap.classList.add("is-playing");

    // 2) Contenedor del reproductor.
    let container = wrap.querySelector<HTMLElement>(".youtube-iframe");
    if (!container) {
      container = document.createElement("div");
      container.className = "youtube-iframe";
      wrap.appendChild(container);
    }

    // 3) Dejar que el navegador pinte y luego cargar YouTube.
    requestAnimationFrame(() => {
      void loadYTApi().then(() => {
        const player = new W.YT!.Player(container!, {
          videoId,
          playerVars: {
            autoplay: 1, controls: 1, rel: 0,
            playsinline: 1, modestbranding: 1, iv_load_policy: 3,
          },
          events: { onReady: (ev: { target: { playVideo(): void } }) => ev.target.playVideo() },
        });
        ytPlayers.set(wrap, player);
      });
    });
  }, { passive: true });
}

// God entry — se ejecuta en cada página que carga /god.js
(function main(): void {
  try {
    const siteUrl = W.__WACRM_SITE_URL__ ?? location.origin;
    initAttribution();
    wireClickBeacons(siteUrl);
    wireYouTubeFacades();
  } catch {}
})();
