import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  loadCopilotAutomationResources,
  type CopilotAutomationResources,
} from './copilot-resources'

interface Call {
  table: string
  select?: string
  filters: { kind: 'eq' | 'in'; column: string; value: unknown }[]
}

function fakeSupabase(args?: {
  rows?: Record<string, Record<string, unknown>[]>
  errors?: Record<string, string>
}) {
  const rows = args?.rows ?? {}
  const errors = args?.errors ?? {}
  const calls: Call[] = []

  const supabase = {
    from(table: string) {
      const call: Call = { table, filters: [] }
      calls.push(call)

      const execute = () => {
        if (errors[table]) {
          return { data: null, error: { message: errors[table] } }
        }
        let data = [...(rows[table] ?? [])]
        for (const filter of call.filters) {
          if (filter.kind === 'eq') {
            data = data.filter((row) => row[filter.column] === filter.value)
          } else {
            const allowed = filter.value as unknown[]
            data = data.filter((row) => allowed.includes(row[filter.column]))
          }
        }
        return { data, error: null }
      }

      const builder = {
        select(columns: string) {
          call.select = columns
          return builder
        },
        eq(column: string, value: unknown) {
          call.filters.push({ kind: 'eq', column, value })
          return builder
        },
        in(column: string, value: unknown[]) {
          call.filters.push({ kind: 'in', column, value })
          return builder
        },
        order() {
          return Promise.resolve(execute())
        },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve(execute()).then(onfulfilled, onrejected)
        },
      }
      return builder
    },
  } as unknown as SupabaseClient

  return { supabase, calls }
}

describe('loadCopilotAutomationResources', () => {
  it('loads the complete account-scoped catalog without exposing member contact data', async () => {
    const { supabase, calls } = fakeSupabase({
      rows: {
        tags: [
          { id: 'tag-1', name: 'VIP', account_id: 'acct-1' },
          { id: 'tag-other', name: 'Other', account_id: 'acct-2' },
        ],
        profiles: [
          {
            user_id: 'user-1',
            full_name: '  Maria Silva  ',
            email: 'must-not-be-selected@example.com',
            account_id: 'acct-1',
          },
        ],
        custom_fields: [
          {
            id: 'field-1',
            field_name: 'Segmento',
            field_type: 'select',
            field_options: { options: ['Enterprise', ' SMB ', 'Enterprise'] },
            account_id: 'acct-1',
          },
        ],
        pipelines: [
          { id: 'pipeline-1', name: 'Vendas', account_id: 'acct-1' },
          { id: 'pipeline-other', name: 'Other', account_id: 'acct-2' },
        ],
        pipeline_stages: [
          { id: 'stage-1', name: 'Fechado', pipeline_id: 'pipeline-1', position: 1 },
          { id: 'stage-other', name: 'Other', pipeline_id: 'pipeline-other', position: 1 },
        ],
        message_templates: [
          {
            id: 'template-1',
            name: 'orcamento',
            language: 'pt_BR',
            status: 'APPROVED',
            account_id: 'acct-1',
          },
          {
            id: 'template-draft',
            name: 'draft',
            language: 'pt_BR',
            status: 'DRAFT',
            account_id: 'acct-1',
          },
        ],
        quick_replies: [
          {
            account_id: 'acct-1',
            kind: 'interactive',
            interactive_payload: {
              kind: 'buttons',
              buttons: [
                { id: 'accept', title: 'Aceitar' },
                { id: 'accept', title: 'Duplicado' },
              ],
            },
          },
          {
            account_id: 'acct-1',
            kind: 'interactive',
            interactive_payload: {
              kind: 'list',
              sections: [
                { rows: [{ id: 'details', title: 'Ver detalhes' }] },
              ],
            },
          },
        ],
      },
    })

    const resources = await loadCopilotAutomationResources(supabase, 'acct-1')

    expect(resources).toEqual<CopilotAutomationResources>({
      tags: [{ id: 'tag-1', name: 'VIP' }],
      members: [{ id: 'user-1', name: 'Maria Silva' }],
      customFields: [
        {
          id: 'field-1',
          name: 'Segmento',
          type: 'select',
          options: ['Enterprise', 'SMB'],
        },
      ],
      pipelines: [
        {
          id: 'pipeline-1',
          name: 'Vendas',
          stages: [{ id: 'stage-1', name: 'Fechado' }],
        },
      ],
      templates: [{ id: 'template-1', name: 'orcamento', language: 'pt_BR' }],
      interactiveReplies: [
        { id: 'accept', label: 'Aceitar' },
        { id: 'details', label: 'Ver detalhes' },
      ],
    })

    const membersCall = calls.find((call) => call.table === 'profiles')
    expect(membersCall?.select).toBe('user_id, full_name')
    expect(membersCall?.select).not.toContain('email')
    expect(calls.every((call) => call.table === 'pipeline_stages'
      || call.filters.some((filter) => filter.column === 'account_id' && filter.value === 'acct-1')))
      .toBe(true)
  })

  it('does not query pipeline_stages when no account pipeline exists', async () => {
    const { supabase, calls } = fakeSupabase()
    const resources = await loadCopilotAutomationResources(supabase, 'acct-1')

    expect(resources.pipelines).toEqual([])
    expect(calls.some((call) => call.table === 'pipeline_stages')).toBe(false)
  })

  it('fails closed when any resource query fails', async () => {
    const { supabase } = fakeSupabase({
      errors: { custom_fields: 'schema cache unavailable' },
    })

    await expect(loadCopilotAutomationResources(supabase, 'acct-1')).rejects.toThrow(
      'Failed to load custom_fields: schema cache unavailable',
    )
  })
})
