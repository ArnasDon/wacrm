// ============================================================
// lead-form.ts — envío del formulario de la landing (DAD §3.2).
//
// Vive en un módulo aparte, NO en un `<script define:vars>` dentro del
// .astro: `define:vars` implica `is:inline`, y Astro no procesa los
// scripts inline — no los compila, no les quita los tipos y no los
// empaqueta. El TypeScript llegaba literal al navegador y reventaba con
// `SyntaxError: Unexpected token ':'` antes de registrar el listener, así
// que el formulario hacía su submit nativo por GET y no llamaba nunca a
// /api/events. Como módulo importado desde un `<script>` normal, Astro sí
// lo transpila y lo empaqueta.
//
// `landingBase` ya no viaja por `define:vars` sino en el atributo
// `data-landing-base` del propio <form>.
//
// Flujo: god.js rellena los hidden (utm_*, click-ids, ref_code, event_id,
// channel, medium, visitor_id) antes del submit → POST JSON a /api/events
// con event_type=form_submit → el server crea el lead y el tracking_event
// → redirect a /thank-you?lead=1&event_id=…
// ============================================================

const FORM_ID = "lead-form";
const ERR_ID = "lead-form-error";

/**
 * Lee un campo del formulario por nombre.
 *
 * El selector es `[name="…"]`, no `input[name="…"]`: `message` es un
 * `<textarea>` y con el selector viejo el mensaje del lead siempre
 * llegaba vacío.
 */
function readField(form: HTMLFormElement, name: string): string {
  const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[name="${CSS.escape(name)}"]`,
  );
  return el?.value ?? "";
}

function showError(msg: string): void {
  const el = document.getElementById(ERR_ID);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function newEventId(): string {
  return `form_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function initLeadForm(): void {
  const form = document.getElementById(FORM_ID) as HTMLFormElement | null;
  if (!form) return;

  const landingBase = form.dataset.landingBase ?? "";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    document.getElementById(ERR_ID)?.classList.add("hidden");

    const name = readField(form, "name");
    const phone = readField(form, "phone").trim();
    const email = readField(form, "email");
    const message = readField(form, "message");

    if (!phone) {
      showError("Por favor ingresa tu teléfono.");
      return;
    }

    const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
    const buttonLabel = button?.textContent ?? "Solicitar información";
    if (button) {
      button.disabled = true;
      button.textContent = "Enviando...";
    }

    const eventId = readField(form, "event_id") || newEventId();
    const attribution = {
      utm: {
        source: readField(form, "utm_source") || undefined,
        medium: readField(form, "utm_medium") || undefined,
        campaign: readField(form, "utm_campaign") || undefined,
        term: readField(form, "utm_term") || undefined,
        content: readField(form, "utm_content") || undefined,
      },
      click_ids: {
        gclid: readField(form, "gclid") || undefined,
        gbraid: readField(form, "gbraid") || undefined,
        wbraid: readField(form, "wbraid") || undefined,
        fbclid: readField(form, "fbclid") || undefined,
        msclkid: readField(form, "msclkid") || undefined,
        ttclid: readField(form, "ttclid") || undefined,
        li_fat_id: readField(form, "li_fat_id") || undefined,
        gad_source: readField(form, "gad_source") || undefined,
      },
      landing_slug: readField(form, "landing_slug") || undefined,
      ref_code: readField(form, "ref_code") || undefined,
      channel: readField(form, "channel") || undefined,
      medium: readField(form, "medium") || undefined,
      visitor_id: readField(form, "visitor_id") || undefined,
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
      window.location.href = `${location.origin}${landingBase}/thank-you?${qs}`;
    } catch {
      showError("Hubo un problema. Intenta de nuevo o escríbenos por WhatsApp.");
      if (button) {
        button.disabled = false;
        button.textContent = buttonLabel;
      }
    }
  });
}

// Los `<script>` empaquetados por Astro son `type="module"` (diferidos),
// así que normalmente el DOM ya está listo. El guard cubre el caso
// contrario sin depender de que DOMContentLoaded no haya disparado ya.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLeadForm, { once: true });
} else {
  initLeadForm();
}
