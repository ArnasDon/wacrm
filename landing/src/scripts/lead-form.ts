// ============================================================
// lead-form.ts — envío del formulario (skill §12.3).
//
// Vive en un módulo aparte, NO en un `<script define:vars>` dentro del
// .astro: `define:vars` implica `is:inline`, y Astro no procesa los scripts
// inline — no los compila, no les quita los tipos y no los empaqueta. El
// TypeScript llegaba literal al navegador y reventaba con `SyntaxError`
// antes de registrar el listener, así que el formulario hacía su submit
// nativo por GET y no llamaba nunca a /api/events.
//
// Gobierna TODOS los formularios `[data-lead-form]` del documento: el de la
// página y el del widget flotante comparten esta lógica.
//
// El destino es /api/events, el flujo de datos que ya existía: el server crea
// el lead (find-or-create por teléfono) e inserta el tracking_event.
// ============================================================

/**
 * Lee un campo por nombre dentro de un formulario concreto.
 *
 * El selector es `[name="…"]`, no `input[name="…"]`: `message` es un
 * `<textarea>` y con el selector viejo el mensaje del lead siempre llegaba
 * vacío.
 */
function readField(form: HTMLFormElement, name: string): string {
  const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[name="${CSS.escape(name)}"]`,
  );
  return el?.value ?? "";
}

function newEventId(): string {
  return `form_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const CLICK_IDS = [
  "gclid", "gbraid", "wbraid", "fbclid", "msclkid", "ttclid", "li_fat_id", "gad_source",
] as const;
const UTMS = ["source", "medium", "campaign", "term", "content"] as const;

function collectClickIds(form: HTMLFormElement): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of CLICK_IDS) out[k] = readField(form, k) || undefined;
  return out;
}

function wire(form: HTMLFormElement): void {
  const errorEl = form.querySelector<HTMLElement>(".form__error");
  // Destino tras el envío, por formulario: el de captación va a /thank-you y
  // el del imán de leads a /thank-you-download, que dispara la descarga. Las
  // dos cuelgan de la raíz, no de /landing (rewrites en next.config.ts).
  const thankYou = form.dataset.thankYou ?? "/thank-you";

  const showError = (msg: string) => {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.hidden = false;
    // El mensaje es role="alert" y recibe el foco (skill §20).
    errorEl.focus();
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.hidden = true;

    // Campo trampa: si viene relleno es un bot. Se finge éxito para no
    // enseñarle al bot cuál fue el motivo del rechazo.
    if (readField(form, "company_website").trim()) return;

    const name = readField(form, "name");
    const phone = readField(form, "phone").trim();
    const email = readField(form, "email");
    const message = readField(form, "message");

    if (!phone) {
      showError("Por favor ingresa tu teléfono.");
      return;
    }

    const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
    const buttonLabel = button?.textContent ?? "";
    if (button) {
      button.disabled = true;
      button.textContent = "Enviando...";
    }

    const eventId = readField(form, "event_id") || newEventId();
    const attribution = {
      utm: Object.fromEntries(
        UTMS.map((k) => [k, readField(form, `utm_${k}`) || undefined]),
      ),
      click_ids: collectClickIds(form),
      landing_slug: readField(form, "landing_slug") || undefined,
      ref_code: readField(form, "ref_code") || undefined,
      channel: readField(form, "channel") || undefined,
      medium: readField(form, "medium") || undefined,
      visitor_id: readField(form, "visitor_id") || undefined,
      // Loop de conversiones: Meta _fbc/_fbp y dominio del referrer viajan
      // en hidden inputs rellenados por god.ts → se propagan al server para
      // el matching de la CAPI y el reporting de adquisición.
      fbc: readField(form, "fbc") || undefined,
      fbp: readField(form, "fbp") || undefined,
      referrer: readField(form, "referrer") || undefined,
    };

    try {
      const res = await fetch(`${location.origin}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: eventId,
          event_type: "form_submit",
          attribution,
          ref_code: attribution.ref_code,
          landing_slug: attribution.landing_slug,
          payload: { name, phone, email, message },
        }),
      });
      if (!res.ok) throw new Error("request failed");
      const qs = new URLSearchParams({ lead: "1", event_id: eventId });
      window.location.href = `${location.origin}${thankYou}?${qs}`;
    } catch {
      showError("Hubo un problema. Intenta de nuevo o escríbenos por WhatsApp.");
      if (button) {
        button.disabled = false;
        button.textContent = buttonLabel;
      }
    }
  });
}

function init(): void {
  document.querySelectorAll<HTMLFormElement>("[data-lead-form]").forEach(wire);
}

// Los `<script>` empaquetados por Astro son `type="module"` (diferidos), así
// que el DOM ya está listo. El guard cubre el caso contrario sin depender de
// que DOMContentLoaded no haya disparado ya.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
