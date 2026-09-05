import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncNewTaskToGoogle, syncUpdatedTaskToGoogle, syncDeletedTaskToGoogle } from './google-sync'
import * as tasksApi from '@/lib/google-calendar/tasks-api'

// google-sync's entire reason to exist is "never let a Google failure
// surface as a task-create/update/delete failure" — these tests are
// deliberately about that swallowing behaviour, not the Google API
// calls themselves (covered in tasks-api.test.ts).

describe('syncNewTaskToGoogle', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('persists the returned ids onto the task row', async () => {
    vi.spyOn(tasksApi, 'createGoogleTask').mockResolvedValue({
      googleTaskId: 'gtask-1',
      googleTaskListId: '@default',
    })
    const updateCalls: Record<string, unknown>[] = []
    const chain = { eq: () => Promise.resolve({ error: null }) }
    const db = {
      from: () => ({
        update: (payload: Record<string, unknown>) => {
          updateCalls.push(payload)
          return chain
        },
      }),
    } as unknown as SupabaseClient

    await syncNewTaskToGoogle(db, 'acct-1', 'task-1', { title: 't', notes: null, dueISO: null })

    expect(updateCalls).toEqual([{ google_task_id: 'gtask-1', google_task_list_id: '@default' }])
  })

  it('does nothing when the account has no Google connection (null ref)', async () => {
    vi.spyOn(tasksApi, 'createGoogleTask').mockResolvedValue(null)
    const update = vi.fn()
    const db = { from: () => ({ update }) } as unknown as SupabaseClient

    await syncNewTaskToGoogle(db, 'acct-1', 'task-1', { title: 't', notes: null, dueISO: null })

    expect(update).not.toHaveBeenCalled()
  })

  it('swallows a thrown GoogleCalendarError instead of propagating it', async () => {
    vi.spyOn(tasksApi, 'createGoogleTask').mockRejectedValue(new Error('boom'))
    const db = {} as unknown as SupabaseClient

    await expect(
      syncNewTaskToGoogle(db, 'acct-1', 'task-1', { title: 't', notes: null, dueISO: null }),
    ).resolves.toBeUndefined()
  })
})

describe('syncUpdatedTaskToGoogle', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('no-ops when the task was never mirrored', async () => {
    const spy = vi.spyOn(tasksApi, 'updateGoogleTask').mockResolvedValue(undefined)
    await syncUpdatedTaskToGoogle(
      {} as SupabaseClient,
      'acct-1',
      { google_task_id: null, google_task_list_id: null },
      { done: true },
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('forwards the ref and patch when the task is mirrored', async () => {
    const spy = vi.spyOn(tasksApi, 'updateGoogleTask').mockResolvedValue(undefined)
    await syncUpdatedTaskToGoogle(
      {} as SupabaseClient,
      'acct-1',
      { google_task_id: 'gtask-1', google_task_list_id: '@default' },
      { done: true },
    )
    expect(spy).toHaveBeenCalledWith(
      {},
      'acct-1',
      { googleTaskId: 'gtask-1', googleTaskListId: '@default' },
      { done: true },
    )
  })

  it('swallows a thrown error', async () => {
    vi.spyOn(tasksApi, 'updateGoogleTask').mockRejectedValue(new Error('boom'))
    await expect(
      syncUpdatedTaskToGoogle(
        {} as SupabaseClient,
        'acct-1',
        { google_task_id: 'gtask-1', google_task_list_id: '@default' },
        { done: true },
      ),
    ).resolves.toBeUndefined()
  })
})

describe('syncDeletedTaskToGoogle', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('no-ops when the task was never mirrored', async () => {
    const spy = vi.spyOn(tasksApi, 'deleteGoogleTask').mockResolvedValue(undefined)
    await syncDeletedTaskToGoogle(
      {} as SupabaseClient,
      'acct-1',
      { google_task_id: null, google_task_list_id: null },
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('swallows a thrown error', async () => {
    vi.spyOn(tasksApi, 'deleteGoogleTask').mockRejectedValue(new Error('boom'))
    await expect(
      syncDeletedTaskToGoogle(
        {} as SupabaseClient,
        'acct-1',
        { google_task_id: 'gtask-1', google_task_list_id: '@default' },
      ),
    ).resolves.toBeUndefined()
  })
})
