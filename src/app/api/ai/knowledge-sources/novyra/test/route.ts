import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  NOVYRA_DEFAULT_AGENT_CODE,
  NOVYRA_DEFAULT_COUNTRY_CODE,
  NOVYRA_PROVIDER,
  novyraServerConfigured,
} from '@/lib/ai/knowledge-sources'
import { testNovyraKnowledgeConnection } from '@/lib/ai/novyra-knowledge'

export async function POST() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data: agent, error: agentError } = await supabase
      .from('ai_configs')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()
    if (agentError) throw agentError
    if (!agent) {
      return NextResponse.json(
        { error: 'Configure primeiro o agente de IA.' },
        { status: 409 },
      )
    }

    if (!novyraServerConfigured()) {
      return NextResponse.json(
        {
          error: 'Configuração do servidor incompleta.',
          code: 'novyra_server_configuration_incomplete',
        },
        { status: 409 },
      )
    }

    let status: 'success' | 'failed' = 'success'
    let message: string
    try {
      const result = await testNovyraKnowledgeConnection()
      message = result.message
    } catch (error) {
      status = 'failed'
      message = error instanceof Error ? error.message : 'Falha desconhecida na ligação.'
    }

    const testedAt = new Date().toISOString()
    const { error: saveError } = await supabase.from('agent_knowledge_sources').upsert(
      {
        account_id: accountId,
        agent_id: agent.id,
        provider: NOVYRA_PROVIDER,
        enabled: false,
        configuration: {
          agentCode: NOVYRA_DEFAULT_AGENT_CODE,
          countryCode: NOVYRA_DEFAULT_COUNTRY_CODE,
        },
        last_test_status: status,
        last_test_message: message.slice(0, 1000),
        last_tested_at: testedAt,
      },
      {
        onConflict: 'agent_id,provider',
        ignoreDuplicates: false,
      },
    )
    if (saveError) throw saveError

    return NextResponse.json(
      {
        success: status === 'success',
        status,
        message,
        tested_at: testedAt,
      },
      { status: status === 'success' ? 200 : 502 },
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
