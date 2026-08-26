/**
 * Pure validators for message templates, run BEFORE the Meta submit
 * call so a misconfigured template fails at save time (with a specific
 * field-level error) rather than at the Meta API boundary (where the
 * error is a generic 400 + opaque rejection_reason hours later).
 *
 * Every validator throws `TemplateValidationError` — callers catch and
 * surface to the UI. `.message` is an English, developer-facing
 * fallback (server logs, non-i18n callers); `.code` + `.values` are
 * what the client actually renders, via `t(code, values)` against the
 * `Settings.templates` namespace (see template-manager.tsx's
 * handleSubmit) — so a validation failure reads in the user's own
 * language instead of always in English. Caps follow Meta's published
 * limits for the Cloud API template surface (v21.0):
 *   https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
 *
 * Per-element button validation lives here rather than as a JSONB CHECK
 * because Postgres CHECK constraints can't contain subqueries, and
 * generic CHECK violations don't give users an actionable error
 * ("button #3 has no `text`" beats "constraint violated").
 */

import type {
  MessageTemplate,
  TemplateButton,
  TemplateSampleValues,
} from '@/types';

export const TEMPLATE_LIMITS = {
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  headerTextMaxLength: 60,
  buttonTextMaxLength: 25,
  maxButtonsTotal: 10,
  maxUrlButtons: 2,
  maxPhoneButtons: 1,
  maxCopyCodeButtons: 1,
  /** Meta: lowercase a-z, digits, underscore. Up to 512 chars. */
  nameRegex: /^[a-z0-9_]{1,512}$/,
} as const;

export interface TemplatePayload {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_type?: MessageTemplate['header_type'];
  header_content?: string;
  header_media_url?: string;
  header_handle?: string;
  body_text: string;
  footer_text?: string;
  buttons?: TemplateButton[];
  sample_values?: TemplateSampleValues;
}

export type TemplateValidationValues = Record<string, string | number>;

/**
 * `code` is a `Settings.templates` translation key (`validation*`);
 * `values` are its ICU interpolation params. `message` stays a plain
 * English sentence for contexts that can't translate (server logs, the
 * odd non-i18n caller) — it's never shown to a user directly.
 */
export class TemplateValidationError extends Error {
  code: string;
  values?: TemplateValidationValues;

  constructor(code: string, message: string, values?: TemplateValidationValues) {
    super(message);
    this.name = 'TemplateValidationError';
    this.code = code;
    this.values = values;
  }
}

function fail(code: string, message: string, values?: TemplateValidationValues): never {
  throw new TemplateValidationError(code, message, values);
}

/**
 * Shapes a caught validation error into the JSON body the API routes
 * return — `code`/`values` let the client translate it via
 * `t(code, values)`; `error` is the English fallback for callers that
 * only read that field (or an unrecognized/non-validation error).
 */
export function templateValidationErrorJson(e: unknown): {
  error: string;
  code?: string;
  values?: TemplateValidationValues;
} {
  if (e instanceof TemplateValidationError) {
    return { error: e.message, code: e.code, values: e.values };
  }
  return { error: e instanceof Error ? e.message : 'Validation failed.' };
}

export function validateTemplateName(name: string): void {
  if (!name) fail('validationNameRequired', 'Template name is required.');
  if (!TEMPLATE_LIMITS.nameRegex.test(name)) {
    fail(
      'validationNameInvalidChars',
      'Template name must use only lowercase letters, digits, and underscores (1-512 chars).',
    );
  }
}

/**
 * Extract sorted, deduplicated {{N}} indices from a string. Returns
 * `[1, 2, 4]` for `"Hi {{1}} {{2}}, item {{4}}"`.
 */
export function extractVariableIndices(text: string): number[] {
  const matches = text.matchAll(/\{\{(\d+)\}\}/g);
  const set = new Set<number>();
  for (const m of matches) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Meta requires contiguous, 1-indexed variables. `{{1}} {{3}}` is
 * invalid — it must be `{{1}} {{2}}`.
 */
function assertContiguous(indices: number[]): void {
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i + 1) {
      const found = indices.map((n) => `{{${n}}}`).join(', ');
      fail(
        'validationBodyVarsNotContiguous',
        `Body variables must be contiguous starting at {{1}} — found ${found}.`,
        { found },
      );
    }
  }
}

export function validateBody(bodyText: string): number[] {
  if (!bodyText.trim()) fail('validationBodyRequired', 'Body text is required.');
  if (bodyText.length > TEMPLATE_LIMITS.bodyMaxLength) {
    fail(
      'validationBodyTooLong',
      `Body text exceeds ${TEMPLATE_LIMITS.bodyMaxLength} chars (got ${bodyText.length}).`,
      { max: TEMPLATE_LIMITS.bodyMaxLength, count: bodyText.length },
    );
  }
  const indices = extractVariableIndices(bodyText);
  assertContiguous(indices);
  return indices;
}

export function validateFooter(footerText: string | undefined): void {
  if (!footerText) return;
  if (footerText.length > TEMPLATE_LIMITS.footerMaxLength) {
    fail(
      'validationFooterTooLong',
      `Footer text exceeds ${TEMPLATE_LIMITS.footerMaxLength} chars (got ${footerText.length}).`,
      { max: TEMPLATE_LIMITS.footerMaxLength, count: footerText.length },
    );
  }
  if (extractVariableIndices(footerText).length > 0) {
    fail(
      'validationFooterHasVariables',
      'Footer text cannot contain {{N}} variables (Meta rule).',
    );
  }
}

export interface HeaderValidationResult {
  /** number of {{N}} placeholders in a TEXT header — 0 or 1. */
  variableCount: number;
}

export function validateHeader(
  payload: Pick<
    TemplatePayload,
    'header_type' | 'header_content' | 'header_media_url' | 'header_handle'
  >,
): HeaderValidationResult {
  const { header_type, header_content, header_media_url, header_handle } = payload;
  if (!header_type) return { variableCount: 0 };

  if (header_type === 'text') {
    if (!header_content || !header_content.trim()) {
      fail('validationHeaderTextRequired', 'Text header requires header_content.');
    }
    if (header_content.length > TEMPLATE_LIMITS.headerTextMaxLength) {
      fail(
        'validationHeaderTextTooLong',
        `Header text exceeds ${TEMPLATE_LIMITS.headerTextMaxLength} chars (got ${header_content.length}).`,
        { max: TEMPLATE_LIMITS.headerTextMaxLength, count: header_content.length },
      );
    }
    const indices = extractVariableIndices(header_content);
    if (indices.length > 1) {
      fail(
        'validationHeaderTextTooManyVars',
        `Text header supports at most one variable — found ${indices.length} (Meta rule).`,
        { count: indices.length },
      );
    }
    if (indices.length === 1 && indices[0] !== 1) {
      fail('validationHeaderTextVarMustBeOne', 'Text header variable must be {{1}} (Meta rule).');
    }
    return { variableCount: indices.length };
  }

  // image / video / document need either a public URL or a Resumable
  // Upload handle. Either one — Meta accepts both example forms.
  if (!header_media_url && !header_handle) {
    fail(
      'validationHeaderMediaRequired',
      `${header_type} header requires either a public sample URL (header_media_url) or a Resumable Upload handle (header_handle).`,
      { type: header_type },
    );
  }
  if (header_media_url) {
    let u: URL;
    try {
      u = new URL(header_media_url);
    } catch {
      fail('validationHeaderMediaUrlInvalid', 'header_media_url must be a valid URL.');
    }
    // https-only — matches the SSRF-guard policy already enforced for
    // webhook_endpoints (normalizeWebhookUrl); a plain http:// sample URL
    // is fetched server-side and gains nothing from also being allowed.
    if (u.protocol !== 'https:') {
      fail('validationHeaderMediaUrlHttps', 'header_media_url must use https.');
    }
  }
  return { variableCount: 0 };
}

function countButtonsByType(
  buttons: TemplateButton[],
): Record<TemplateButton['type'], number> {
  const counts: Record<TemplateButton['type'], number> = {
    QUICK_REPLY: 0,
    URL: 0,
    PHONE_NUMBER: 0,
    COPY_CODE: 0,
  };
  for (const b of buttons) counts[b.type]++;
  return counts;
}

export function validateButtons(buttons: TemplateButton[] | undefined): void {
  if (!buttons || buttons.length === 0) return;
  if (buttons.length > TEMPLATE_LIMITS.maxButtonsTotal) {
    fail(
      'validationButtonsTooMany',
      `Templates can have at most ${TEMPLATE_LIMITS.maxButtonsTotal} buttons (got ${buttons.length}).`,
      { max: TEMPLATE_LIMITS.maxButtonsTotal, count: buttons.length },
    );
  }

  const counts = countButtonsByType(buttons);
  if (counts.URL > TEMPLATE_LIMITS.maxUrlButtons) {
    fail(
      'validationButtonsUrlTooMany',
      `At most ${TEMPLATE_LIMITS.maxUrlButtons} URL buttons allowed (got ${counts.URL}).`,
      { max: TEMPLATE_LIMITS.maxUrlButtons, count: counts.URL },
    );
  }
  if (counts.PHONE_NUMBER > TEMPLATE_LIMITS.maxPhoneButtons) {
    fail(
      'validationButtonsPhoneTooMany',
      `At most ${TEMPLATE_LIMITS.maxPhoneButtons} PHONE_NUMBER button allowed (got ${counts.PHONE_NUMBER}).`,
      { max: TEMPLATE_LIMITS.maxPhoneButtons, count: counts.PHONE_NUMBER },
    );
  }
  if (counts.COPY_CODE > TEMPLATE_LIMITS.maxCopyCodeButtons) {
    fail(
      'validationButtonsCopyCodeTooMany',
      `At most ${TEMPLATE_LIMITS.maxCopyCodeButtons} COPY_CODE button allowed (got ${counts.COPY_CODE}).`,
      { max: TEMPLATE_LIMITS.maxCopyCodeButtons, count: counts.COPY_CODE },
    );
  }

  // Meta rule: QUICK_REPLY buttons must be contiguous — they can't be
  // interleaved with CTA buttons. Easiest check: walk the array; once
  // we leave the QUICK_REPLY block, we must not see another.
  let sawNonQR = false;
  for (const b of buttons) {
    if (b.type === 'QUICK_REPLY') {
      if (sawNonQR) {
        fail(
          'validationButtonsQuickReplyInterleaved',
          'QUICK_REPLY buttons cannot be interleaved with URL / PHONE_NUMBER / COPY_CODE buttons — group them at the start.',
        );
      }
    } else {
      sawNonQR = true;
    }
  }

  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    const idx = i + 1;
    if (!b.text?.trim()) {
      fail('validationButtonMissingText', `Button #${idx} (${b.type}) is missing text.`, {
        index: idx,
        type: b.type,
      });
    }
    if (b.text.length > TEMPLATE_LIMITS.buttonTextMaxLength) {
      fail(
        'validationButtonTextTooLong',
        `Button #${idx} text exceeds ${TEMPLATE_LIMITS.buttonTextMaxLength} chars.`,
        { index: idx, max: TEMPLATE_LIMITS.buttonTextMaxLength },
      );
    }
    switch (b.type) {
      case 'URL': {
        if (!b.url?.trim()) {
          fail('validationButtonUrlMissing', `URL button #${idx} is missing url.`, { index: idx });
        }
        try {
          new URL(b.url);
        } catch {
          fail('validationButtonUrlInvalid', `URL button #${idx} has an invalid url.`, {
            index: idx,
          });
        }
        const urlVars = extractVariableIndices(b.url);
        if (urlVars.length > 1) {
          fail(
            'validationButtonUrlTooManyVars',
            `URL button #${idx} can have at most one variable (Meta rule).`,
            { index: idx },
          );
        }
        if (urlVars.length === 1) {
          if (urlVars[0] !== 1) {
            fail(
              'validationButtonUrlVarMustBeOne',
              `URL button #${idx} variable must be {{1}} (Meta rule).`,
              { index: idx },
            );
          }
          if (!b.example?.trim()) {
            fail(
              'validationButtonUrlExampleRequired',
              `URL button #${idx} uses {{1}} — Meta requires an example value.`,
              { index: idx },
            );
          }
        }
        break;
      }
      case 'PHONE_NUMBER':
        if (!b.phone_number?.trim()) {
          fail(
            'validationButtonPhoneMissing',
            `PHONE_NUMBER button #${idx} is missing phone_number.`,
            { index: idx },
          );
        }
        break;
      case 'COPY_CODE':
        if (!b.example?.trim()) {
          fail(
            'validationButtonCopyCodeExampleMissing',
            `COPY_CODE button #${idx} is missing example value.`,
            { index: idx },
          );
        }
        break;
    }
  }
}

/**
 * Sample values must be supplied 1:1 with the variables in the body
 * (and header, if it has one). Meta uses these for human review.
 */
export function validateSampleValues(
  payload: TemplatePayload,
  bodyVarCount: number,
  headerVarCount: number,
): void {
  const samples = payload.sample_values ?? {};
  const body = samples.body ?? [];
  const header = samples.header ?? [];

  if (body.length !== bodyVarCount) {
    fail(
      'validationSampleBodyCountMismatch',
      `Body has ${bodyVarCount} variable(s) — supply exactly ${bodyVarCount} sample value(s) (got ${body.length}).`,
      { varCount: bodyVarCount, gotCount: body.length },
    );
  }
  if (header.length !== headerVarCount) {
    fail(
      'validationSampleHeaderCountMismatch',
      `Header has ${headerVarCount} variable(s) — supply exactly ${headerVarCount} sample value(s) (got ${header.length}).`,
      { varCount: headerVarCount, gotCount: header.length },
    );
  }
  for (let i = 0; i < body.length; i++) {
    if (!body[i] || !body[i].trim()) {
      fail('validationSampleBodyValueEmpty', `Body sample value #${i + 1} is empty.`, {
        index: i + 1,
      });
    }
  }
  for (let i = 0; i < header.length; i++) {
    if (!header[i] || !header[i].trim()) {
      fail('validationSampleHeaderValueEmpty', `Header sample value #${i + 1} is empty.`, {
        index: i + 1,
      });
    }
  }
}

/**
 * Run every validator. Throws on the first failure with a specific,
 * field-level message. Returns the variable counts so callers can
 * reuse them when building the Meta components payload.
 */
export function validateTemplatePayload(payload: TemplatePayload): {
  bodyVarCount: number;
  headerVarCount: number;
} {
  validateTemplateName(payload.name);
  if (!payload.language?.trim()) {
    fail('validationLanguageRequired', 'Language is required.');
  }
  const bodyVars = validateBody(payload.body_text);
  validateFooter(payload.footer_text);
  const headerResult = validateHeader(payload);
  validateButtons(payload.buttons);
  validateSampleValues(payload, bodyVars.length, headerResult.variableCount);
  return {
    bodyVarCount: bodyVars.length,
    headerVarCount: headerResult.variableCount,
  };
}
