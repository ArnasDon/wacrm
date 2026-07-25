import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: {
    adminCalls: 0,
    insertCalls: [] as Record<string, unknown>[][],
    deleteCalls: [] as Array<{ column: string; value: unknown }>,
    insertError: null as { message: string } | null,
    deleteError: null as { message: string } | null,
  },
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => {
    h.state.adminCalls += 1
    return {
      from: (table: string) => {
        if (table !== 'automation_steps') {
          throw new Error(`unexpected table ${table}`)
        }
        return {
          insert: (rows: Record<string, unknown>[]) => {
            h.state.insertCalls.push(rows)
            return Promise.resolve({ error: h.state.insertError })
          },
          delete: () => ({
            eq: (column: string, value: unknown) => {
              h.state.deleteCalls.push({ column, value })
              return Promise.resolve({ error: h.state.deleteError })
            },
          }),
        }
      },
    }
  },
}))

import {
  insertSteps,
  replaceSteps,
  type BuilderStepInput,
} from './steps-tree'

beforeEach(() => {
  h.state.adminCalls = 0
  h.state.insertCalls = []
  h.state.deleteCalls = []
  h.state.insertError = null
  h.state.deleteError = null
})

describe('insertSteps', () => {
  it('promotes flat seeds with invalid or non-condition parents to roots without changing root order', async () => {
    const seeds: BuilderStepInput[] = [
      {
        id: 'linear-root',
        step_type: 'send_message',
        step_config: { text: 'hello' },
        branch: null,
        parent_index: null,
      },
      {
        id: 'non-condition-child',
        step_type: 'wait',
        step_config: { amount: 1, unit: 'hours' },
        branch: 'yes',
        parent_index: 0,
      },
      {
        id: 'condition-root',
        step_type: 'condition',
        step_config: { subject: 'tag_presence' },
        branch: null,
        parent_index: null,
      },
      {
        id: 'valid-child',
        step_type: 'add_tag',
        step_config: { tag_id: 'tag-1' },
        branch: 'no',
        parent_index: 2,
      },
      {
        id: 'missing-parent-child',
        step_type: 'close_conversation',
        step_config: {},
        branch: 'yes',
        parent_index: 99,
      },
      {
        id: 'last-root',
        step_type: 'wait',
        step_config: { amount: 2, unit: 'days' },
        branch: null,
        parent_index: null,
      },
    ]

    await expect(insertSteps('automation-1', seeds)).resolves.toBeNull()

    expect(h.state.insertCalls).toHaveLength(1)
    const rows = h.state.insertCalls[0]
    expect(rows.map((row) => row.id)).toEqual([
      'linear-root',
      'non-condition-child',
      'condition-root',
      'valid-child',
      'missing-parent-child',
      'last-root',
    ])
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'linear-root',
        parent_step_id: null,
        branch: null,
        position: 0,
      }),
      expect.objectContaining({
        id: 'non-condition-child',
        parent_step_id: null,
        branch: null,
        position: 1,
      }),
      expect.objectContaining({
        id: 'condition-root',
        parent_step_id: null,
        branch: null,
        position: 2,
      }),
      expect.objectContaining({
        id: 'valid-child',
        parent_step_id: 'condition-root',
        branch: 'no',
        position: 0,
      }),
      expect.objectContaining({
        id: 'missing-parent-child',
        parent_step_id: null,
        branch: null,
        position: 3,
      }),
      expect.objectContaining({
        id: 'last-root',
        parent_step_id: null,
        branch: null,
        position: 4,
      }),
    ])
  })

  it('returns an explicit error and performs no write for branches on a non-condition step', async () => {
    const invalid: BuilderStepInput[] = [
      {
        id: 'linear',
        step_type: 'send_message',
        step_config: { text: 'hello' },
        branches: {
          yes: [
            {
              id: 'lost-before-fix',
              step_type: 'wait',
              step_config: { amount: 1, unit: 'hours' },
            },
          ],
          no: [],
        },
      },
    ]

    const error = await insertSteps('automation-1', invalid)

    expect(error).toContain('cannot contain non-empty branches')
    expect(error).toContain('only condition steps can have branches')
    expect(h.state.adminCalls).toBe(0)
    expect(h.state.insertCalls).toHaveLength(0)
  })
})

describe('replaceSteps', () => {
  it('validates the complete tree before deleting the persisted steps', async () => {
    const invalid: BuilderStepInput[] = [
      {
        id: 'linear',
        step_type: 'send_message',
        step_config: { text: 'hello' },
        branches: {
          no: [
            {
              id: 'lost-before-fix',
              step_type: 'close_conversation',
              step_config: {},
            },
          ],
        },
      },
    ]

    const error = await replaceSteps('automation-1', invalid)

    expect(error).toContain('cannot contain non-empty branches')
    expect(h.state.adminCalls).toBe(0)
    expect(h.state.deleteCalls).toHaveLength(0)
    expect(h.state.insertCalls).toHaveLength(0)
  })

  it('deletes and inserts only after a valid replacement has been prepared', async () => {
    const valid: BuilderStepInput[] = [
      {
        id: 'condition',
        step_type: 'condition',
        step_config: { subject: 'tag_presence' },
        branches: {
          yes: [
            {
              id: 'child',
              step_type: 'send_message',
              step_config: { text: 'hello' },
            },
          ],
          no: [],
        },
      },
    ]

    await expect(replaceSteps('automation-1', valid)).resolves.toBeNull()

    expect(h.state.adminCalls).toBe(1)
    expect(h.state.deleteCalls).toEqual([
      { column: 'automation_id', value: 'automation-1' },
    ])
    expect(h.state.insertCalls).toHaveLength(1)
  })
})
