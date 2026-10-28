import type { SupabaseClient } from '@supabase/supabase-js'

import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateDeepSeek } from './providers/deepseek'
import { replacePropertySubjectiveKnowledge } from './knowledge'
import { aiRequestTimeoutMs } from './defaults'
import {
  clearPropertyLearningEvidence,
  compactForMatch,
  getPropertyLearningEvidenceCount,
  meetsPropertyCreationEvidence,
  resolvePropertyIdentity,
} from './property-identity'
import type { AiConfig } from './types'
import type { LearningConfidence } from './learning-types'

/** Postgres SQLSTATE for a unique-constraint violation — same code this
 *  codebase already checks elsewhere (src/lib/contacts/tag-write.ts). */
const UNIQUE_VIOLATION_CODE = '23505'

/** Minimum recurrence for a `property_subjective` learning to be applied
 *  without human review — anything less stays `pending` for manual
 *  approval, same as every other learning type. */
export const AUTO_APPLY_MIN_OCCURRENCES = 3

/**
 * Only `property_subjective` learnings can ever qualify: they're the one
 * type the model already can't use to leak price/handoff/security rules
 * (see learning-types.ts price-tampering guard). Every other type keeps
 * requiring manual approval, by design.
 */
export function meetsAutoApplyThreshold(candidate: {
  confidence: LearningConfidence
  is_isolated: boolean
  occurrence_count: number
}): boolean {
  return (
    candidate.confidence === 'high' &&
    candidate.is_isolated === false &&
    candidate.occurrence_count >= AUTO_APPLY_MIN_OCCURRENCES
  )
}

/**
 * Resolves a name the AI extracted from conversation to an existing
 * property — tolerant of typos, missing/extra letters, spacing and
 * punctuation differences, abbreviations ("Liv Park", "LivePark" →
 * "Live Park") — and only auto-creates a brand new `provisorio`
 * property when BOTH of the following hold:
 *   1. resolvePropertyIdentity finds no existing property that's a safe
 *      or even plausible/ambiguous match (an ambiguous result NEVER
 *      creates — it's left for a human to sort out);
 *   2. the name has accumulated durable evidence of real recurrence —
 *      MIN_PROPERTY_LEARNING_CONVERSATIONS distinct, context-bearing
 *      conversations (see property-identity.ts) — not just a name that
 *      happened to come up a lot within one conversation, or a single
 *      confident-sounding mention.
 * A single mention, however confident, can never create a property on
 * its own — "uma menção isolada não é um novo empreendimento".
 *
 * Idempotent under concurrency: the identity check, evidence check, and
 * final INSERT below are three separate round-trips, not one atomic
 * transaction — two overlapping calls (two overlapping cron runs, or a
 * manual approval racing the auto-apply path) for the exact same
 * empreendimento — even written with different spacing/separators, e.g.
 * "LivePark" vs "Live Park" — can both pass the checks and both attempt
 * the INSERT. The database-level guard is what actually prevents the
 * duplicate: a partial unique index on (account_id, normalized_name)
 * (see migration 20260911150000), where normalized_name is the SAME
 * compact form (compactForMatch — separators removed entirely) that
 * resolvePropertyIdentity's own exact-match check already treats as one
 * identity. Using the spaced form here instead would let two
 * spacing/separator variants of the same brand-new name race past the
 * constraint, since "livepark" and "live park" are different strings to
 * Postgres even though the resolver treats them as identical. The
 * loser's INSERT fails with a unique_violation, recovered here by
 * looking up and returning the winner's id instead of surfacing a hard
 * error — two concurrent calls for the same new empreendimento, however
 * differently spaced, always converge on the same property_id.
 */
export async function resolveOrCreateProperty(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  propertyName: string,
): Promise<string | null> {
  const trimmed = propertyName.trim()
  if (!trimmed) return null

  const resolution = await resolvePropertyIdentity(db, accountId, trimmed)
  if (resolution.kind === 'safe_match') return resolution.propertyId
  if (resolution.kind === 'ambiguous') return null // never guess between plausible existing properties

  // kind === 'no_match': nothing existing is even plausible — but that
  // alone still isn't proof this is a real, new empreendimento.
  const evidenceCount = await getPropertyLearningEvidenceCount(db, accountId, trimmed)
  if (!meetsPropertyCreationEvidence(evidenceCount)) return null

  // Compact form (separators removed entirely) — the exact same notion
  // of identity resolvePropertyIdentity's own exact-match check uses
  // (existingCompact === candidateCompact). A name that normalizes to
  // nothing (e.g. entirely non-Latin script) stores NULL rather than an
  // empty string: the unique index only covers non-NULL values, so two
  // unrelated degenerate names never collide with each other or with an
  // unrelated property under the same blank key.
  const normalizedName = compactForMatch(trimmed) || null

  const { data: newProp, error: createErr } = await db
    .from('properties')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      name: trimmed,
      normalized_name: normalizedName,
      status: 'provisorio',
      created_from_learning: true,
    })
    .select('id')
    .single()

  if (createErr) {
    if (createErr.code === UNIQUE_VIOLATION_CODE && normalizedName) {
      // Someone else (another concurrent call — possibly for a
      // differently-spaced spelling of the very same empreendimento)
      // won the race and already created it — reuse their row instead
      // of failing, so the caller always ends up with a valid, single
      // property_id. Keyed by the same compact normalized_name the
      // index itself enforces uniqueness on.
      const { data: existing } = await db
        .from('properties')
        .select('id')
        .eq('account_id', accountId)
        .eq('normalized_name', normalizedName)
        .maybeSingle()
      if (existing) return existing.id as string
    }
    console.error('[property learning] failed to auto-create provisional property:', createErr)
    return null
  }
  if (!newProp) return null

  await clearPropertyLearningEvidence(db, accountId, trimmed)
  return newProp.id as string
}

const FUSION_SYSTEM_PROMPT =
  'Você mantém a "Visão do Corretor" de um imóvel — um texto único, corrido, na voz do corretor, sobre um empreendimento imobiliário.'

function buildFusionUserPrompt(prevKnowledge: string | null, newInfo: string): string {
  return `TEXTO ATUAL (pode ser vazio se for a primeira informação):
"""
${prevKnowledge || ''}
"""

NOVA OBSERVAÇÃO CONFIRMADA (padrão recorrente identificado em conversas reais):
"""
${newInfo}
"""

Reescreva o texto completo incorporando a nova observação de forma natural e integrada ao que já existe.
- Nunca invente, deduza ou complete informação que não esteja em nenhum dos dois textos.
- Se a nova observação contradiz algo do texto atual, mantenha a mais recente e recorrente, mas não apague silenciosamente o histórico se ainda for relevante.
- Não crie uma lista de bullets crescente. Funda a nova informação na narrativa existente, reescrevendo frases quando necessário.
- Mantenha o texto abaixo de aproximadamente 2500 palavras; se ultrapassar, resuma trechos redundantes.
- Responda apenas com o texto final, sem comentários.`
}

/**
 * Rewrites the property's "Visão do Corretor" as one coherent narrative
 * instead of concatenating bullets — unbounded bullet concatenation was
 * turning every approved learning into its own embedding chunk, diluting
 * semantic search quality over time.
 */
export async function fusePropertySubjectiveKnowledge(
  config: Pick<AiConfig, 'provider' | 'apiKey' | 'model' | 'deepseekApiKey'>,
  prevKnowledge: string | null,
  newInfo: string,
): Promise<string> {
  const activeKey =
    config.provider === 'deepseek'
      ? (config.deepseekApiKey || config.apiKey)
      : config.apiKey
  const providerArgs = {
    apiKey: activeKey,
    model: config.model,
    systemPrompt: FUSION_SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: buildFusionUserPrompt(prevKnowledge, newInfo) }],
    timeoutMs: aiRequestTimeoutMs(),
  }
  const { text } =
    config.provider === 'openai'
      ? await generateOpenAi(providerArgs)
      : config.provider === 'deepseek'
        ? await generateDeepSeek(providerArgs)
        : await generateAnthropic(providerArgs)
  const fused = text.trim()
  return fused || newInfo
}

export interface ApplyPropertySubjectiveResult {
  propertyId: string
  previousKnowledge: string | null
}

/**
 * Determines which property (if any) a `property_subjective` learning
 * applies to — never trusting an externally supplied `propertyId` (LLM
 * output, payload, or any other outside source) on its own:
 *   - When a `propertyName` is present, identity is always determined by
 *     resolveOrCreateProperty/resolvePropertyIdentity; a supplied id can
 *     only be used when it agrees with that resolution (a safe match to
 *     the very same property). Any mismatch — wrong account, a name
 *     that resolves elsewhere, ambiguity, insufficient evidence — means
 *     the id is ignored and the resolver's own (possibly null) result
 *     wins instead.
 *   - Without a `propertyName` to resolve against, a supplied id is only
 *     used once confirmed to actually exist within this account.
 * This closes the path where a property_id smuggled into a suggestion's
 * payload (today: never actually produced by the learning prompt, but
 * not something to leave unguarded) could bypass identity resolution
 * entirely.
 */
async function resolveTrustedPropertyId(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  args: { propertyId?: string | null; propertyName?: string | null },
): Promise<string | null> {
  const suppliedId = args.propertyId || null

  if (args.propertyName) {
    const resolvedByName = await resolveOrCreateProperty(db, accountId, ownerUserId, args.propertyName)
    if (!resolvedByName) return null // ambiguous / insufficient evidence — never fall back to a raw id here
    if (!suppliedId || suppliedId === resolvedByName) return resolvedByName

    // A supplied id that disagrees with the resolved identity is never
    // trusted, even if it happens to be a valid property in this
    // account — the resolver is the single source of truth for identity.
    console.warn(
      '[property learning] supplied property_id does not match resolved identity — ignoring the supplied id',
    )
    return resolvedByName
  }

  if (!suppliedId) return null

  const { data: existing } = await db
    .from('properties')
    .select('id')
    .eq('id', suppliedId)
    .eq('account_id', accountId)
    .maybeSingle()
  return existing ? (existing.id as string) : null
}

/**
 * Shared "approve a property_subjective learning" pipeline — used by both
 * the manual PATCH approval (suggestions/[id]/route.ts) and the cron's
 * auto-apply path (learning-generate.ts), so the two never drift: resolve
 * or auto-create the provisional property, fuse the knowledge
 * semantically, and persist through the single correct write path
 * (replacePropertySubjectiveKnowledge — never a direct table write, or
 * the indexed copy diverges from the source).
 */
export async function applyPropertySubjectiveLearning(
  db: SupabaseClient,
  accountId: string,
  config: AiConfig,
  ownerUserId: string,
  args: { propertyId?: string | null; propertyName?: string | null; info: string },
): Promise<ApplyPropertySubjectiveResult | null> {
  const propId = await resolveTrustedPropertyId(db, accountId, ownerUserId, args)
  if (!propId) return null

  const { data: currentCtx } = await db
    .from('property_ai_contexts')
    .select('subjective_knowledge')
    .eq('property_id', propId)
    .eq('account_id', accountId)
    .maybeSingle()

  const previousKnowledge = (currentCtx?.subjective_knowledge as string | null) || null
  const fusedKnowledge = await fusePropertySubjectiveKnowledge(config, previousKnowledge, args.info)

  await replacePropertySubjectiveKnowledge(db, accountId, { embeddingsApiKey: config.embeddingsApiKey }, propId, {
    subjectiveKnowledge: fusedKnowledge,
  })

  return { propertyId: propId, previousKnowledge }
}
