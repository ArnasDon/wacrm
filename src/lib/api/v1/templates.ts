// ============================================================
// Shared template logic for the public API (v1) template endpoints.
//
// Templates are read-only over the public API — submission/edit/
// resubmit against Meta stays a dashboard-only flow (it needs the
// account's connected WhatsApp config and hits Meta's Graph API
// directly; see src/app/api/whatsapp/templates/*). The public API's
// job is discovery: let an integrator look up a template's approved
// `name`/`language`/variables before calling `POST /api/v1/messages`
// with `type: "template"`.
// ============================================================

import type { TemplateButton, TemplateSampleValues } from '@/types';

export const TEMPLATE_SELECT = '*';

export interface ApiTemplate {
  id: string;
  name: string;
  category: string;
  language: string | null;
  header_type: string | null;
  header_content: string | null;
  header_media_url: string | null;
  body_text: string;
  footer_text: string | null;
  buttons: TemplateButton[] | null;
  sample_values: TemplateSampleValues | null;
  status: string | null;
  quality_score: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Flatten a `message_templates` row into the public template shape. */
export function serializeTemplate(row: Record<string, unknown>): ApiTemplate {
  return {
    id: row.id as string,
    name: row.name as string,
    category: row.category as string,
    language: (row.language as string | null) ?? null,
    header_type: (row.header_type as string | null) ?? null,
    header_content: (row.header_content as string | null) ?? null,
    header_media_url: (row.header_media_url as string | null) ?? null,
    body_text: row.body_text as string,
    footer_text: (row.footer_text as string | null) ?? null,
    buttons: (row.buttons as TemplateButton[] | null) ?? null,
    sample_values: (row.sample_values as TemplateSampleValues | null) ?? null,
    status: (row.status as string | null) ?? null,
    quality_score: (row.quality_score as string | null) ?? null,
    rejection_reason: (row.rejection_reason as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
