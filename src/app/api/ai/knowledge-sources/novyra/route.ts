import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  getNovyraSource,
  NOVYRA_DEFAULT_AGENT_CODE,
  NOVYRA_DEFAULT_COUNTRY_CODE,
  NOVYRA_PROVIDER,
  novyraServerConfigured,
} from '@/lib/ai/knowledge-sources'

async function resolveAgentId(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
) {
  const { data, error } = await supabase
    .from('ai_configs')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const agentId = await resolveAgentId(supabase, accountId)
    const configured = novyraServerConfigured()

    if (!agentId) {
      return NextResponse.json({
        configured,
        agent_id: null,
        enabled: false,
        configuration: {
          agentCode: NOVYRA_DEFAULT_AGENT_CODE,
          countryCode: NOVYRA_DEFAULT_COUNTRY_CODE,
        },
        last_test_status: null,
        last_test_message: null,
        last_tested_at: null,
      })
    }

    const source = await getNovyraSource(supabase, accountId, agentId)
    return NextResponse.json({
      configured,
      agent_id: agentId,
      enabled: source.enabled,
      configuration: source.configuration,
      last_test_status: source.lastTestStatus,
      last_test_message: source.lastTestMessage,
      last_tested_at: source.lastTestedAt,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 })
    }

    if (body.enabled && !novyraServerConfigured()) {
      return NextResponse.json(
        {
          error: 'Configuração do servidor incompleta.',
          code: 'novyra_server_configuration_incomplete',
        },
        { status: 409 },
      )
    }

    const agentId = await resolveAgentId(supabase, accountId)
    if (!agentId) {
      return NextResponse.json(
        { error: 'Configure primeiro o agente de IA.' },
        { status: 409 },
      )
    }

    const { error } = await supabase.from('agent_knowledge_sources').upsert(
      {
        account_id: accountId,
        agent_id: agentId,
        provider: NOVYRA_PROVIDER,
        enabled: body.enabled,
        configuration: {
          agentCode: NOVYRA_DEFAULT_AGENT_CODE,
          countryCode: NOVYRA_DEFAULT_COUNTRY_CODE,
        },
      },
      { onConflict: 'agent_id,provider' },
    )
    if (error) throw error

    const source = await getNovyraSource(supabase, accountId, agentId)
    return NextResponse.json({ success: true, enabled: source.enabled })
  } catch (error) {
    return toErrorResponse(error)
  }
}
