import { NextResponse } from 'next/server'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAllFlowTemplates } from '@/lib/flows/templates'

/**
 * GET /api/flows/templates
 *
 * Returns the static template gallery (slug + name + description +
 * icon hint + node_count) so the New-flow dialog can render cards
 * without bundling the full template payloads client-side. Bodies
 * are fetched only on actual clone via POST /api/flows.
 *
 * Available to any signed-in user. Flows is in soft-GA.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Shallow shape so the client gallery doesn't have to know about
  // the full node tree.
  const t = await getTranslations('Flows.templates')
  const templates = resolveAllFlowTemplates(t).map((tpl) => ({
    slug: tpl.slug,
    name: tpl.name,
    description: tpl.description,
    icon: tpl.icon,
    trigger_type: tpl.trigger_type,
    node_count: tpl.nodes.length,
  }))
  return NextResponse.json({ templates })
}
