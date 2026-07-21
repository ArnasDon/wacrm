import type { SupabaseClient } from '@supabase/supabase-js'

export interface AutomationResources {
  tags: { id: string; name: string }[]
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[]
}

/**
 * Real, account-scoped tags/pipelines/stages — the AI surfaces (agent
 * decisions, automation copilot drafts) are only allowed to reference
 * ids from this list; the sanitizer in each caller enforces that, not
 * this loader.
 */
export async function loadAutomationResources(
  supabase: SupabaseClient,
  accountId: string,
): Promise<AutomationResources> {
  const [
    { data: tags, error: tagsError },
    { data: pipelines, error: pipelinesError },
  ] = await Promise.all([
    supabase.from('tags').select('id, name').eq('account_id', accountId),
    supabase.from('pipelines').select('id, name').eq('account_id', accountId),
  ])

  if (tagsError) throw new Error(`Failed to load tags: ${tagsError.message}`)
  if (pipelinesError) throw new Error(`Failed to load pipelines: ${pipelinesError.message}`)

  const pipelineIds = ((pipelines ?? []) as { id: string; name: string }[]).map((p) => p.id)

  // pipeline_stages has no account_id column of its own — it's only isolated via
  // RLS through the pipeline_id -> pipelines.account_id join. Callers on the
  // service-role path (e.g. agent-dispatch.ts, which bypasses RLS entirely) must
  // scope this fetch explicitly to the account's own pipeline ids.
  const { data: stages, error: stagesError } =
    pipelineIds.length > 0
      ? await supabase
          .from('pipeline_stages')
          .select('id, name, pipeline_id')
          .in('pipeline_id', pipelineIds)
          .order('position', { ascending: true })
      : { data: [] as { id: string; name: string; pipeline_id: string }[], error: null }

  if (stagesError) throw new Error(`Failed to load pipeline_stages: ${stagesError.message}`)

  const stagesByPipeline = new Map<string, { id: string; name: string }[]>()
  for (const s of (stages ?? []) as { id: string; name: string; pipeline_id: string }[]) {
    const list = stagesByPipeline.get(s.pipeline_id) ?? []
    list.push({ id: s.id, name: s.name })
    stagesByPipeline.set(s.pipeline_id, list)
  }

  return {
    tags: ((tags ?? []) as { id: string; name: string }[]).map((t) => ({ id: t.id, name: t.name })),
    pipelines: ((pipelines ?? []) as { id: string; name: string }[]).map((p) => ({
      id: p.id,
      name: p.name,
      stages: stagesByPipeline.get(p.id) ?? [],
    })),
  }
}
