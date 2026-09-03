/**
 * Translate our local template row shape into the `components` array
 * shape that Meta's POST /{waba_id}/message_templates endpoint expects.
 *
 * Keep this function pure and JSON-shaped — the submit route and the
 * (future) edit route both call it, and unit tests assert the exact
 * payload by snapshot.
 *
 * Spec reference:
 *   https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/components
 */

import type { TemplatePayload } from './template-validators';
import type { TemplateButton } from '@/types';

export interface MetaComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  text?: string;
  buttons?: MetaButtonPayload[];
  example?: {
    header_text?: string[];
    header_url?: string[];
    header_handle?: string[];
    body_text?: string[][];
  };
}

interface MetaButtonPayload {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';
  text: string;
  url?: string;
  phone_number?: string;
  example?: string[];
}

function buildHeaderComponent(payload: TemplatePayload): MetaComponent | null {
  const { header_type, header_content, header_media_url, header_handle } = payload;
  if (!header_type) return null;

  if (header_type === 'text') {
    const headerSample = payload.sample_values?.header;
    const component: MetaComponent = {
      type: 'HEADER',
      format: 'TEXT',
      text: header_content,
    };
    if (headerSample && headerSample.length > 0) {
      component.example = { header_text: headerSample };
    }
    return component;
  }

  const format =
    header_type === 'image'
      ? 'IMAGE'
      : header_type === 'video'
        ? 'VIDEO'
        : 'DOCUMENT';
  const component: MetaComponent = { type: 'HEADER', format };
  if (header_handle) {
    component.example = { header_handle: [header_handle] };
  } else if (header_media_url) {
    component.example = { header_url: [header_media_url] };
  }
  return component;
}

function buildBodyComponent(payload: TemplatePayload): MetaComponent {
  const component: MetaComponent = {
    type: 'BODY',
    text: payload.body_text,
  };
  const bodySample = payload.sample_values?.body;
  if (bodySample && bodySample.length > 0) {
    // Meta expects body_text as a 2D array — outer is "examples",
    // inner is the values for each variable. We submit a single
    // example row.
    component.example = { body_text: [bodySample] };
  }
  return component;
}

function buildFooterComponent(payload: TemplatePayload): MetaComponent | null {
  if (!payload.footer_text?.trim()) return null;
  return { type: 'FOOTER', text: payload.footer_text };
}

function buildButtonPayload(b: TemplateButton): MetaButtonPayload {
  switch (b.type) {
    case 'QUICK_REPLY':
      return { type: 'QUICK_REPLY', text: b.text };
    case 'URL': {
      const payload: MetaButtonPayload = {
        type: 'URL',
        text: b.text,
        url: b.url,
      };
      if (b.example) payload.example = [b.example];
      return payload;
    }
    case 'PHONE_NUMBER':
      return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number };
    case 'COPY_CODE':
      return { type: 'COPY_CODE', text: b.text, example: [b.example] };
  }
}

function buildButtonsComponent(payload: TemplatePayload): MetaComponent | null {
  if (!payload.buttons || payload.buttons.length === 0) return null;
  return {
    type: 'BUTTONS',
    buttons: payload.buttons.map(buildButtonPayload),
  };
}

export interface MetaTemplateSubmitPayload {
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  components: MetaComponent[];
}

const CATEGORY_TO_META: Record<
  'Marketing' | 'Utility' | 'Authentication',
  MetaTemplateSubmitPayload['category']
> = {
  Marketing: 'MARKETING',
  Utility: 'UTILITY',
  Authentication: 'AUTHENTICATION',
};

/**
 * Assemble the full submit payload (name + category + language +
 * components in canonical order: HEADER → BODY → FOOTER → BUTTONS).
 */
export function buildMetaTemplatePayload(
  payload: TemplatePayload,
): MetaTemplateSubmitPayload {
  const components: MetaComponent[] = [];
  const header = buildHeaderComponent(payload);
  if (header) components.push(header);
  components.push(buildBodyComponent(payload));
  const footer = buildFooterComponent(payload);
  if (footer) components.push(footer);
  const buttons = buildButtonsComponent(payload);
  if (buttons) components.push(buttons);

  return {
    name: payload.name,
    category: CATEGORY_TO_META[payload.category],
    language: payload.language,
    components,
  };
}

// ============================================================
// Meta → Zernio components translation.
//
// Zernio proxies Meta's template API, and *returns* the plain uppercase
// Meta shape on GET — but its `create` (and `edit`) endpoint validates
// `components` against a discriminated union keyed on the LOWERCASE
// `type` (`header` | `body` | `footer` | `buttons` | …) and rejects
// Meta's own uppercase with:
//   "Invalid discriminator value. Expected 'header' | 'body' | 'footer'
//    | 'buttons' | 'limited_time_offer' | 'carousel'"
// Only the enum casing differs — `type` on each component, `type` on
// each button, and the header `format`. Field names (`text`, `url`,
// `phone_number`, `example`, `buttons`) are the same on both sides.
// ============================================================

export interface ZernioComponent {
  type: 'header' | 'body' | 'footer' | 'buttons';
  format?: 'text' | 'image' | 'video' | 'document';
  text?: string;
  buttons?: ZernioButtonPayload[];
  example?: MetaComponent['example'];
}

interface ZernioButtonPayload {
  type: 'quick_reply' | 'url' | 'phone_number' | 'copy_code';
  text: string;
  url?: string;
  phone_number?: string;
  example?: string[];
}

/** Lowercase the `type`/`format` discriminators so Zernio's create/edit
 *  schema accepts the array `buildMetaTemplatePayload` produces. */
export function metaComponentsToZernio(
  components: MetaComponent[],
): ZernioComponent[] {
  return components.map((c) => {
    const out: ZernioComponent = {
      type: c.type.toLowerCase() as ZernioComponent['type'],
    };
    if (c.format) {
      out.format = c.format.toLowerCase() as ZernioComponent['format'];
    }
    if (c.text !== undefined) out.text = c.text;
    if (c.example !== undefined) out.example = c.example;
    if (c.buttons) {
      out.buttons = c.buttons.map((b) => {
        const btn: ZernioButtonPayload = {
          type: b.type.toLowerCase() as ZernioButtonPayload['type'],
          text: b.text,
        };
        if (b.url !== undefined) btn.url = b.url;
        if (b.phone_number !== undefined) btn.phone_number = b.phone_number;
        if (b.example !== undefined) btn.example = b.example;
        return btn;
      });
    }
    return out;
  });
}
