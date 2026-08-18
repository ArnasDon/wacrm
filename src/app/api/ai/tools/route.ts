import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'
import { validateToolConfig } from '@/lib/ai/tools/validate'

// AI agent tools — account-scoped HTTP calls the agent can invoke.
// GET lists (any member, secret never returned); POST creates (admin+,
// mirrors /api/ai/config's "requireRole + RLS-scoped client" shape,
// since ai_tools carries a live external credential like ai_configs
// does).

const MAX_TOOLS_PER_ACCOUNT = 15

const LIST_COLUMNS =
  'id, name, description, method, url, headers, auth_type, auth_header_name, auth_secret, parameters, timeout_ms, is_active, created_at, updated_at'

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('ai_tools')
      .select(LIST_COLUMNS)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[ai/tools GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load tools' }, { status: 500 })
    }
    const tools = (data ?? []).map(({ auth_secret, ...rest }) => ({
      ...rest,
      has_secret: !!auth_secret,
    }))
    return NextResponse.json({ tools })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-tools:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { count } = await supabase
      .from('ai_tools')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if ((count ?? 0) >= MAX_TOOLS_PER_ACCOUNT) {
      return NextResponse.json(
        { error: `An account may have at most ${MAX_TOOLS_PER_ACCOUNT} tools.` },
        { status: 400 },
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const issues = validateToolConfig(body, {
      requireSecret: (body.auth_type ?? 'none') !== 'none',
    })
    if (issues.length > 0) {
      return NextResponse.json({ error: issues[0].message, issues }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('ai_tools')
      .insert({
        account_id: accountId,
        created_by: userId,
        name: body.name,
        description: body.description,
        method: body.method,
        url: body.url,
        headers: body.headers ?? {},
        auth_type: body.auth_type ?? 'none',
        auth_header_name: body.auth_header_name || null,
        auth_secret: body.auth_secret ? encrypt(String(body.auth_secret)) : null,
        parameters: body.parameters ?? [],
        timeout_ms: body.timeout_ms ?? 8000,
        is_active: body.is_active !== false,
      })
      .select(LIST_COLUMNS)
      .single()

    if (error) {
      // Postgres unique_violation on (account_id, name).
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A tool with this name already exists.' },
          { status: 400 },
        )
      }
      console.error('[ai/tools POST] insert error:', error)
      return NextResponse.json({ error: 'Failed to create tool' }, { status: 500 })
    }

    const { auth_secret, ...rest } = data
    return NextResponse.json({ tool: { ...rest, has_secret: !!auth_secret } }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
