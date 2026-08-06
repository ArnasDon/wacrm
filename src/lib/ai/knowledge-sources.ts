import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export const NOVYRA_PROVIDER = 'novyra' as const
export const NOVYRA_DEFAULT_AGENT_CODE = 'novura-news-whatsapp'
export const NOVYRA_DEFAULT_COUNTRY_CODE = 'MZ'

export interface AgentKnowledgeSource {
  id: string | null
  accountId: string
  agentId: string
  provider: typeof NOVYRA_PROVIDER
  enabled: boolean
  configuration: {
    agentCode: string
    countryCode: string
  }
  lastTestStatus: 'success' | 'failed' | null
  lastTestMessage: string | null
  lastTestedAt: string | null
}

interface SourceRow {
  id: string
  account_id: string
  agent_id: string
  provider: string
  enabled: boolean
  configuration: Record<string, unknown> | null
  last_test_status: 'success' | 'failed' | null
  last_test_message: string | null
  last_tested_at: string | null
}

export function novyraServerConfigured(): boolean {
  return Boolean(
    process.env.NOVYRA_SUPABASE_URL &&
      process.env.NOVYRA_SUPABASE_ANON_KEY &&
      process.env.NOVYRA_CRM_USER_EMAIL &&
      process.env.NOVYRA_CRM_USER_PASSWORD &&
      process.env.NOVYRA_AGENT_CODE &&
      process.env.NOVYRA_COUNTRY_CODE,
  )
}

export function shouldUseNovyraSource(
  enabled: boolean,
  serverConfigured = novyraServerConfigured(),
): boolean {
  return enabled && serverConfigured
}

function normaliseConfiguration(value: Record<string, unknown> | null | undefined) {
  return {
    agentCode:
      typeof value?.agentCode === 'string' && value.agentCode.trim()
        ? value.agentCode
        : NOVYRA_DEFAULT_AGENT_CODE,
    countryCode:
      typeof value?.countryCode === 'string' && value.countryCode.trim()
        ? value.countryCode
        : NOVYRA_DEFAULT_COUNTRY_CODE,
  }
}

export async function getNovyraSource(
  db: WacrmSupabaseClient,
  accountId: string,
  agentId: string,
): Promise<AgentKnowledgeSource> {
  const { data, error } = await db
    .from('agent_knowledge_sources')
    .select(
      'id, account_id, agent_id, provider, enabled, configuration, last_test_status, last_test_message, last_tested_at',
    )
    .eq('account_id', accountId)
    .eq('agent_id', agentId)
    .eq('provider', NOVYRA_PROVIDER)
    .maybeSingle()

  if (error) throw error

  const row = data as SourceRow | null
  return {
    id: row?.id ?? null,
    accountId,
    agentId,
    provider: NOVYRA_PROVIDER,
    enabled: row?.enabled ?? false,
    configuration: normaliseConfiguration(row?.configuration),
    lastTestStatus: row?.last_test_status ?? null,
    lastTestMessage: row?.last_test_message ?? null,
    lastTestedAt: row?.last_tested_at ?? null,
  }
}

export async function isNovyraEnabledForAgent(
  db: WacrmSupabaseClient,
  accountId: string,
  agentId: string,
): Promise<boolean> {
  if (!novyraServerConfigured()) return false
  const source = await getNovyraSource(db, accountId, agentId)
  return shouldUseNovyraSource(source.enabled, true)
}
