// ============================================================
// Shapes for the lead-analysis extraction (BLOCO 2/4).
//
// `LeadAnalysisResult` is what we ask the model to return as strict
// JSON (no provider JSON-mode/tool-calling exists in this codebase —
// see providers/openai.ts + providers/anthropic.ts — so this is
// enforced by prompt instructions and parsed defensively here).
// ============================================================

export type TagConfidence = 'low' | 'medium' | 'high';
export type TagAction = 'add' | 'remove';

/** Current-state structured summary — see BLOCO 2/4 spec section 15.
 *  Replaced wholesale on every run (never appended to): the model is
 *  given the previous summary as input and returns the next full
 *  state, so a retracted preference naturally drops out. */
export interface LeadSummary {
  /** Finalidade: e.g. ["investimento", "moradia"]. */
  purpose: string[];
  /** Tipo de imóvel: e.g. ["flat"]. */
  property_type: string[];
  /** Bairro/localização: e.g. ["Bessa"]. */
  location: string[];
  price_min: number | null;
  price_max: number | null;
  /** Ceiling the client accepts for an exceptional opportunity. */
  price_flex_max: number | null;
  /** Quartos: e.g. [2, 3] when the client accepts either. */
  bedrooms: number[];
  features: string[];
  /** Perfil do lead — free text drawn from the suggested vocabulary in
   *  the prompt (e.g. "comprador de primeira aquisição"). */
  profile: string[];
  /** Sinal de intenção — free text (e.g. "curiosidade", "intenção
   *  forte"), not a hard enum: section 5 explicitly wants gradation. */
  intent: string | null;
  /** Momento comercial — free text note on where the lead is now. */
  stage_signal: string | null;
  notes: string | null;
}

export interface TagChange {
  category: string;
  name: string;
  action: TagAction;
  confidence: TagConfidence;
}

export interface StageSuggestion {
  should_suggest: boolean;
  target_stage_name: string | null;
  justification: string | null;
  /** 0–100. */
  score: number | null;
}

export interface LeadAnalysisResult {
  summary: LeadSummary;
  tag_changes: TagChange[];
  stage_suggestion: StageSuggestion | null;
}

export function emptyLeadSummary(): LeadSummary {
  return {
    purpose: [],
    property_type: [],
    location: [],
    price_min: null,
    price_max: null,
    price_flex_max: null,
    bedrooms: [],
    features: [],
    profile: [],
    intent: null,
    stage_signal: null,
    notes: null,
  };
}

const TAG_CONFIDENCES: readonly TagConfidence[] = ['low', 'medium', 'high'];

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim());
}

function numberArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
}

function nullableNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function nullableString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function sanitizeSummary(v: unknown): LeadSummary {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    purpose: stringArray(o.purpose),
    property_type: stringArray(o.property_type),
    location: stringArray(o.location),
    price_min: nullableNumber(o.price_min),
    price_max: nullableNumber(o.price_max),
    price_flex_max: nullableNumber(o.price_flex_max),
    bedrooms: numberArray(o.bedrooms),
    features: stringArray(o.features),
    profile: stringArray(o.profile),
    intent: nullableString(o.intent),
    stage_signal: nullableString(o.stage_signal),
    notes: nullableString(o.notes),
  };
}

function sanitizeTagChanges(v: unknown): TagChange[] {
  if (!Array.isArray(v)) return [];
  const out: TagChange[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const category = typeof o.category === 'string' ? o.category.trim() : '';
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const action = o.action === 'remove' ? 'remove' : o.action === 'add' ? 'add' : null;
    const confidence = TAG_CONFIDENCES.includes(o.confidence as TagConfidence)
      ? (o.confidence as TagConfidence)
      : 'low';
    if (!category || !name || !action) continue;
    out.push({ category, name, action, confidence });
  }
  return out;
}

function sanitizeStageSuggestion(v: unknown): StageSuggestion | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const shouldSuggest = o.should_suggest === true;
  if (!shouldSuggest) return { should_suggest: false, target_stage_name: null, justification: null, score: null };
  const targetStageName = nullableString(o.target_stage_name);
  const score = nullableNumber(o.score);
  if (!targetStageName || score === null) {
    return { should_suggest: false, target_stage_name: null, justification: null, score: null };
  }
  return {
    should_suggest: true,
    target_stage_name: targetStageName,
    justification: nullableString(o.justification),
    score: Math.max(0, Math.min(100, Math.round(score))),
  };
}

/**
 * Parse the model's raw text output into a `LeadAnalysisResult`.
 * Never throws — returns `null` on anything that isn't recoverable
 * JSON, which callers treat as "no evidence, do nothing" (the safest
 * failure mode for an unattended job).
 */
export function parseLeadAnalysisResult(raw: string): LeadAnalysisResult | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;

  return {
    summary: sanitizeSummary(o.summary),
    tag_changes: sanitizeTagChanges(o.tag_changes),
    stage_suggestion: sanitizeStageSuggestion(o.stage_suggestion),
  };
}
