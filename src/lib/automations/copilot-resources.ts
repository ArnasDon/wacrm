import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomFieldType } from '@/lib/contacts/custom-field-types'
import { coerceCustomFieldType, parseSelectOptions } from '@/lib/contacts/custom-field-types'

export interface CopilotNamedResource {
  id: string
  name: string
}

export interface CopilotPipeline extends CopilotNamedResource {
  stages: CopilotNamedResource[]
}

export interface CopilotCustomField extends CopilotNamedResource {
  type: CustomFieldType
  options: string[]
}

export interface CopilotTemplate extends CopilotNamedResource {
  language: string
}

export interface CopilotInteractiveReply {
  id: string
  label: string
}

export interface CopilotAutomationResources {
  tags: CopilotNamedResource[]
  members: CopilotNamedResource[]
  customFields: CopilotCustomField[]
  pipelines: CopilotPipeline[]
  templates: CopilotTemplate[]
  interactiveReplies: CopilotInteractiveReply[]
}

type QueryResult<T> = {
  data: T[] | null
  error: { message: string } | null
}

type InteractivePayload = {
  kind?: unknown
  buttons?: unknown
  sections?: unknown
}

/**
 * Account-scoped resource catalog for the automation copilot.
 *
 * This deliberately stays separate from loadAutomationResources(), whose
 * smaller tag/pipeline catalog is also used by agent-dispatch. Member rows
 * expose only the auth user id and display name: email, phone, and other
 * profile fields never enter the model context.
 */
export async function loadCopilotAutomationResources(
  supabase: SupabaseClient,
  accountId: string,
): Promise<CopilotAutomationResources> {
  const [
    tagsResult,
    membersResult,
    customFieldsResult,
    pipelinesResult,
    templatesResult,
    quickRepliesResult,
  ] = await Promise.all([
    supabase.from('tags').select('id, name').eq('account_id', accountId),
    supabase.from('profiles').select('user_id, full_name').eq('account_id', accountId),
    supabase
      .from('custom_fields')
      .select('id, field_name, field_type, field_options')
      .eq('account_id', accountId),
    supabase.from('pipelines').select('id, name').eq('account_id', accountId),
    supabase
      .from('message_templates')
      .select('id, name, language')
      .eq('account_id', accountId)
      .eq('status', 'APPROVED'),
    supabase
      .from('quick_replies')
      .select('interactive_payload')
      .eq('account_id', accountId)
      .eq('kind', 'interactive'),
  ])

  assertQuery('tags', tagsResult)
  assertQuery('profiles', membersResult)
  assertQuery('custom_fields', customFieldsResult)
  assertQuery('pipelines', pipelinesResult)
  assertQuery('message_templates', templatesResult)
  assertQuery('quick_replies', quickRepliesResult)

  const pipelineRows = (pipelinesResult.data ?? []) as { id: string; name: string }[]
  const pipelineIds = pipelineRows.map((pipeline) => pipeline.id)
  const stagesResult: QueryResult<{ id: string; name: string; pipeline_id: string }> =
    pipelineIds.length > 0
      ? await supabase
          .from('pipeline_stages')
          .select('id, name, pipeline_id')
          .in('pipeline_id', pipelineIds)
          .order('position', { ascending: true })
      : { data: [], error: null }

  assertQuery('pipeline_stages', stagesResult)

  const stagesByPipeline = new Map<string, CopilotNamedResource[]>()
  for (const stage of stagesResult.data ?? []) {
    const stages = stagesByPipeline.get(stage.pipeline_id) ?? []
    stages.push({ id: stage.id, name: stage.name })
    stagesByPipeline.set(stage.pipeline_id, stages)
  }

  return {
    tags: ((tagsResult.data ?? []) as { id: string; name: string }[]).map(({ id, name }) => ({
      id,
      name,
    })),
    members: ((membersResult.data ?? []) as { user_id: string; full_name: string }[])
      .filter((member) => member.user_id && member.full_name?.trim())
      .map((member) => ({ id: member.user_id, name: member.full_name.trim() })),
    customFields: (
      (customFieldsResult.data ?? []) as {
        id: string
        field_name: string
        field_type: unknown
        field_options: unknown
      }[]
    ).map((field) => ({
      id: field.id,
      name: field.field_name,
      type: coerceCustomFieldType(field.field_type),
      options: parseSelectOptions(field.field_options),
    })),
    pipelines: pipelineRows.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      stages: stagesByPipeline.get(pipeline.id) ?? [],
    })),
    templates: (
      (templatesResult.data ?? []) as { id: string; name: string; language: string | null }[]
    ).map((template) => ({
      id: template.id,
      name: template.name,
      language: template.language?.trim() || 'en_US',
    })),
    interactiveReplies: extractInteractiveReplies(
      (quickRepliesResult.data ?? []) as { interactive_payload: unknown }[],
    ),
  }
}

function assertQuery<T>(table: string, result: QueryResult<T>): void {
  if (result.error) {
    throw new Error(`Failed to load ${table}: ${result.error.message}`)
  }
}

function extractInteractiveReplies(
  rows: { interactive_payload: unknown }[],
): CopilotInteractiveReply[] {
  const replies = new Map<string, CopilotInteractiveReply>()

  for (const row of rows) {
    if (!row.interactive_payload || typeof row.interactive_payload !== 'object') continue
    const payload = row.interactive_payload as InteractivePayload

    if (payload.kind === 'buttons' && Array.isArray(payload.buttons)) {
      for (const button of payload.buttons) addInteractiveReply(replies, button)
    }

    if (payload.kind === 'list' && Array.isArray(payload.sections)) {
      for (const section of payload.sections) {
        if (!section || typeof section !== 'object') continue
        const listRows = (section as { rows?: unknown }).rows
        if (!Array.isArray(listRows)) continue
        for (const listRow of listRows) addInteractiveReply(replies, listRow)
      }
    }
  }

  return [...replies.values()]
}

function addInteractiveReply(
  replies: Map<string, CopilotInteractiveReply>,
  candidate: unknown,
): void {
  if (!candidate || typeof candidate !== 'object') return
  const { id, title } = candidate as { id?: unknown; title?: unknown }
  if (typeof id !== 'string' || !id.trim()) return
  if (typeof title !== 'string' || !title.trim()) return
  const normalizedId = id.trim()
  if (!replies.has(normalizedId)) {
    replies.set(normalizedId, { id: normalizedId, label: title.trim() })
  }
}
