import { supabaseAdmin } from '@/lib/automations/admin-client'
import type { AiConfig } from './types'

export type AutomationGenerationResult = 'draft' | 'question' | 'failed'

export interface AutomationGenerationTelemetry {
  accountId: string
  userId: string
  config: Pick<AiConfig, 'provider' | 'model'>
  result: AutomationGenerationResult
  failureCode: string | null
  generationCount: number
  repairCount: number
  verificationCount: number
  promptTokens: number
  completionTokens: number
  durationMs: number
  issueCount: number
  draftHash: string | null
}

/**
 * Persists the strict metadata allow-list from migration 041. This function
 * intentionally has no prompt, history, current draft, or generated content
 * parameters, making accidental content storage harder at the call site.
 */
export async function recordAutomationGeneration(
  telemetry: AutomationGenerationTelemetry,
): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from('ai_automation_generations')
    .insert({
      account_id: telemetry.accountId,
      user_id: telemetry.userId,
      provider: telemetry.config.provider,
      model: telemetry.config.model,
      result: telemetry.result,
      failure_code: telemetry.failureCode,
      generation_count: telemetry.generationCount,
      repair_count: telemetry.repairCount,
      verification_count: telemetry.verificationCount,
      prompt_tokens: telemetry.promptTokens,
      completion_tokens: telemetry.completionTokens,
      duration_ms: telemetry.durationMs,
      issue_count: telemetry.issueCount,
      draft_hash: telemetry.draftHash,
    })
    .select('id')
    .single()

  if (error) {
    throw new Error(`Failed to record AI automation generation: ${error.message}`)
  }
  if (!data?.id || typeof data.id !== 'string') {
    throw new Error('Failed to record AI automation generation: no id returned')
  }
  return data.id
}
