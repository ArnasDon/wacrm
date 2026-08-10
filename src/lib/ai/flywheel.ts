import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { generateReply } from './generate'
import { loadAiConfig } from './config'

const NO_LESSON_MARKER = '[SEM_LICAO]'
const MAX_LESSON_CHARS = 400
const DEFAULT_SINCE_HOURS = 14 * 24
const DEFAULT_DETECT_LIMIT = 5

interface HandoffConversationRow {
  id: string
  account_id: string
  ai_handoff_summary: string | null
  ai_handoff_at: string | null
}

export interface FlywheelDetectResult {
  created: number
  skipped: number
  failed: number
}

/**
 * Build the "lições aprendidas" block folded into the auto-reply system
 * prompt. Deliberately separate from the account's own `system_prompt`
 * text: applying/dismissing a suggestion only ever changes a row's
 * `status`, never rewrites what the owner wrote by hand.
 */
export function lessonsPrompt(lessons: string[]): string | null {
  const clean = lessons.map((lesson) => lesson.trim()).filter(Boolean).slice(0, 8)
  if (clean.length === 0) return null
  return [
    'Lições aprendidas — regras destiladas de situações reais em que este agente teve de pedir ajuda humana. Segue-as como parte do teu comportamento normal, sem as mencionar ao cliente.',
    ...clean.map((lesson, index) => `[L${index + 1}] ${lesson}`),
  ].join('\n\n')
}

/** Applied lessons for this account, most recently applied first. */
export async function retrieveAppliedLessons(
  db: WacrmSupabaseClient,
  accountId: string,
  limit = 8,
): Promise<string[]> {
  const { data, error } = await db
    .from('agent_suggestions')
    .select('content')
    .eq('account_id', accountId)
    .eq('kind', 'lesson')
    .eq('status', 'applied')
    .order('applied_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[ai flywheel] retrieveAppliedLessons failed:', error)
    return []
  }
  return (data ?? []).map((row) => (row as { content: string }).content).filter(Boolean)
}

function fingerprintFor(conversationId: string, handoffAt: string): string {
  return `${conversationId}:${handoffAt}`
}

/**
 * Scan recent AI→human handoffs across every account and draft a candidate
 * "lesson" suggestion from each one the LLM judges reusable. Never applies
 * anything — a human always reviews and clicks apply. Safe to call
 * repeatedly: each handoff is fingerprinted by (conversation, handoff time),
 * so a re-run skips anything already drafted without spending a token.
 */
export async function runHandoffLessonDetector(
  db: WacrmSupabaseClient,
  opts: { accountId?: string; sinceHours?: number; limit?: number } = {},
): Promise<FlywheelDetectResult> {
  const sinceHours = opts.sinceHours ?? DEFAULT_SINCE_HOURS
  const limit = opts.limit ?? DEFAULT_DETECT_LIMIT
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1_000).toISOString()

  let query = db
    .from('conversations')
    .select('id, account_id, ai_handoff_summary, ai_handoff_at')
    .not('ai_handoff_at', 'is', null)
    .not('ai_handoff_summary', 'is', null)
    .gte('ai_handoff_at', since)
    .order('ai_handoff_at', { ascending: false })
    .limit(50)
  if (opts.accountId) query = query.eq('account_id', opts.accountId)

  const { data, error } = await query
  if (error) {
    console.error('[ai flywheel] handoff scan failed:', error)
    return { created: 0, skipped: 0, failed: 1 }
  }

  let created = 0
  let skipped = 0
  let failed = 0

  for (const row of (data ?? []) as HandoffConversationRow[]) {
    if (created >= limit) break
    const summary = row.ai_handoff_summary?.trim()
    if (!summary || !row.ai_handoff_at) {
      skipped += 1
      continue
    }
    const fingerprint = fingerprintFor(row.id, row.ai_handoff_at)

    try {
      const { data: existing, error: existingError } = await db
        .from('agent_suggestions')
        .select('id')
        .eq('account_id', row.account_id)
        .eq('kind', 'lesson')
        .eq('fingerprint', fingerprint)
        .maybeSingle()
      if (existingError) throw existingError
      if (existing) {
        skipped += 1
        continue
      }

      const config = await loadAiConfig(db, row.account_id)
      if (!config) {
        skipped += 1
        continue
      }

      const generated = await generateReply({
        config,
        systemPrompt:
          'O teu agente de IA de atendimento por WhatsApp teve de pedir ajuda humana numa conversa com um cliente. ' +
          'A partir da razão indicada, escreve UMA regra curta e concreta (1-2 frases, em português) que o agente deveria seguir no futuro para lidar melhor com este tipo de situação — uma instrução directa ao agente, não uma explicação. ' +
          'Não repitas a razão nem cites o cliente. Se a razão for demasiado específica a este caso único, sem padrão reutilizável para o futuro, responde exactamente ' +
          NO_LESSON_MARKER +
          ' e nada mais.',
        messages: [
          {
            role: 'user',
            content: `Contexto do negócio: ${config.systemPrompt?.trim() || '(sem contexto definido)'}\n\nRazão do pedido de ajuda humana: ${summary}`,
          },
        ],
      })

      const lesson = generated.text.replace(/\s+/g, ' ').trim().slice(0, MAX_LESSON_CHARS)
      if (!lesson || lesson.toLocaleUpperCase('en-US').includes(NO_LESSON_MARKER)) {
        skipped += 1
        continue
      }

      const { error: insertError } = await db.from('agent_suggestions').insert({
        account_id: row.account_id,
        kind: 'lesson',
        status: 'pending',
        fingerprint,
        title: summary.slice(0, 120),
        content: lesson,
        evidence: {
          conversation_id: row.id,
          handoff_summary: summary,
          handoff_at: row.ai_handoff_at,
        },
      })
      if (insertError) throw insertError
      created += 1
    } catch (err) {
      failed += 1
      console.error('[ai flywheel] lesson draft failed:', { conversationId: row.id, err })
    }
  }

  return { created, skipped, failed }
}
