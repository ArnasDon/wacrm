/**
 * Map Meta Template Library rows (and our curated starters) into
 * TemplateFormData for the create editor.
 */

import type { TemplateButton } from "@/types";
import type { MetaLibraryTemplate } from "@/lib/whatsapp/meta-api";
import type { WhatsAppStarterTemplate } from "@/lib/whatsapp/starter-templates";
import {
  extractVariableIndices,
  normalizeTemplateButtons,
  sanitizeTemplateName,
} from "@/lib/whatsapp/template-validators";

export type LibraryFormData = WhatsAppStarterTemplate["form"];

function normalizeLanguage(raw?: string): string {
  // Keep Meta's locale as returned — `en` and `en_US` are distinct.
  if (!raw?.trim()) return "en_US";
  return raw.trim();
}

function mapLibraryButtons(
  buttons: MetaLibraryTemplate["buttons"],
): TemplateButton[] {
  if (!buttons?.length) return [];
  const out: TemplateButton[] = [];
  for (const b of buttons) {
    const type = String(b.type || "").toUpperCase();
    const text = (b.text || "").trim() || "Button";
    if (type === "QUICK_REPLY") {
      out.push({ type: "QUICK_REPLY", text });
    } else if (type === "URL") {
      const url = (b.url || "https://www.example.com").trim();
      const hasVar = extractVariableIndices(url).length > 0;
      out.push({
        type: "URL",
        text,
        url,
        ...(hasVar && {
          example: (b.example || "sample").trim() || "sample",
        }),
      });
    } else if (type === "PHONE_NUMBER") {
      out.push({
        type: "PHONE_NUMBER",
        text,
        phone_number: b.phone_number || "+15551234567",
      });
    } else if (type === "COPY_CODE" || type === "OTP") {
      out.push({
        type: "COPY_CODE",
        text: text === "Button" ? "Copy code" : text,
        example: b.example || "CODE123",
      });
    }
  }
  return normalizeTemplateButtons(out);
}

function padBodySamples(bodyText: string, rawSamples: string[]): string[] {
  const count = extractVariableIndices(bodyText).length;
  const samples = rawSamples.map((s) => String(s ?? "").trim());
  while (samples.length < count) {
    samples.push(`Sample ${samples.length + 1}`);
  }
  return samples.slice(0, count).map((s, i) => s || `Sample ${i + 1}`);
}

/** Convert a Meta Template Library item into editor form state. */
export function metaLibraryItemToForm(
  item: MetaLibraryTemplate,
): LibraryFormData {
  const header = (item.header || "").trim();
  const hasHeaderVar = /\{\{\d+\}\}/.test(header);
  const body_text = (item.body || "").trim();
  return {
    name: sanitizeTemplateName(item.name) || "template",
    category: "Utility",
    language: normalizeLanguage(item.language),
    header_format: header ? "text" : "none",
    header_content: header,
    header_media_url: "",
    header_handle: "",
    header_sample: hasHeaderVar ? "Sample" : "",
    body_text,
    body_samples: padBodySamples(
      body_text,
      Array.isArray(item.body_params) ? item.body_params.map(String) : [],
    ),
    footer_text: (item.footer || "").trim(),
    buttons: mapLibraryButtons(item.buttons),
  };
}

export function starterToForm(
  starter: WhatsAppStarterTemplate,
): LibraryFormData {
  return {
    ...starter.form,
    buttons: normalizeTemplateButtons(starter.form.buttons),
  };
}
