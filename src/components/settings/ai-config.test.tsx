// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ============================================================
// AI Agents Setup → "Eliminar" (agent config) — destructive-action
// confirmation security fix. This is the exact button from the
// reported screenshot: it deletes the whole ai_configs row, including
// the provider's API key and (if set) the embeddings key.
//
// Child settings sections (Knowledge Base, Data Sources, Catalog
// Integrations) are stubbed out here — this file only proves the
// wiring of AiConfig's OWN destructive action. The two-step
// confirm/cancel/error/double-click guarantees themselves are already
// proven exhaustively in destructive-confirm-dialog.test.tsx and are
// not re-tested per call site.
// ============================================================

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'acct-1',
    accountRole: 'admin',
    profileLoading: false,
    defaultCurrency: 'USD',
  }),
}))

// Stable function reference across renders, matching real next-intl's
// own internal memoization (see data-sources-settings.test.tsx for why
// a fresh closure per render would be observably wrong).
const translate = (key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key
vi.mock('next-intl', () => ({
  useTranslations: () => translate,
}))

vi.mock('./ai-knowledge', () => ({ AiKnowledgeCard: () => null }))
vi.mock('./data-sources-settings', () => ({ DataSourcesSettings: () => null }))
vi.mock('./catalog-integrations-settings', () => ({ CatalogIntegrationsSettings: () => null }))
// Not in scope here (Business Profile is a separate, already-shipped
// feature this task must not touch) — stubbed purely for isolation, same
// as the three sibling sections above. Without this, BusinessProfileSettings'
// own six per-section "Guardar" buttons render for real and collide with
// this file's `screen.getByText('save')` queries for AiConfig's own button.
vi.mock('./business-profile-settings', () => ({ BusinessProfileSettings: () => null }))
vi.mock('@/lib/account/members', () => ({
  fetchAccountMembers: vi.fn().mockResolvedValue([]),
  memberLabel: (m: { user_id: string }) => m.user_id,
}))

// sonner's toast has no <Toaster/> mounted in this test tree and its
// output does not land anywhere `screen` can find via text queries (see
// business-profile-settings.test.tsx for the same finding) — the
// pre-existing "Eliminar" tests below never asserted on toast content,
// but the new failed-save test does, so it needs this spy. `vi.hoisted`
// is required because `vi.mock` factories are hoisted above normal
// variable declarations.
const { toastMock } = vi.hoisted(() => ({ toastMock: { success: vi.fn(), error: vi.fn() } }))
vi.mock('sonner', () => ({ toast: toastMock }))

import { AiConfig } from './ai-config'

const DEFAULT_CONFIG = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  system_prompt: 'Be helpful.',
  is_active: true,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  handoff_agent_id: null,
  has_key: true,
  has_embeddings_key: false,
}

/**
 * Stateful fetch mock — an in-memory "current config" that GET always
 * reflects and POST actually mutates (translating `api_key`/
 * `embeddings_api_key` into the derived `has_key`/`has_embeddings_key`
 * booleans, exactly like route.ts does — the real keys are write-only
 * and never echoed back). This matters because AiConfig's own
 * `handleSave()` does NOT trust the POST response for the new state —
 * it calls `fetchConfig()` (a fresh GET) afterwards — so a mock that
 * only ever returns a fixed canned GET response would never actually
 * exercise that real save→refetch round trip the way production does.
 * `calls` keeps the same `{url, method}` log the original mock exposed,
 * so the pre-existing "Eliminar" tests below need no changes.
 */
function mockFetchSequence(deleteOk = true, initialConfig: Record<string, unknown> | null = DEFAULT_CONFIG) {
  const calls: { url: string; method: string }[] = []
  const posts: Record<string, unknown>[] = []
  let config = initialConfig ? { ...initialConfig } : null

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({ url: String(url), method })
      if (String(url) !== '/api/ai/config') return new Response(JSON.stringify({}), { status: 200 })

      if (method === 'GET') {
        return new Response(
          JSON.stringify(config ? { configured: true, ...config } : { configured: false }),
          { status: 200 },
        )
      }
      if (method === 'POST') {
        const body = JSON.parse(String(init!.body)) as Record<string, unknown>
        posts.push(body)
        const { api_key, embeddings_api_key, ...rest } = body
        config = {
          ...(config ?? {}),
          ...rest,
          has_key: api_key ? true : (config?.has_key ?? false),
          has_embeddings_key: embeddings_api_key ? true : (config?.has_embeddings_key ?? false),
        }
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }
      if (method === 'DELETE') {
        if (!deleteOk) {
          return new Response(JSON.stringify({ error: 'Failed to delete AI configuration' }), { status: 500 })
        }
        config = null
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }),
  )
  return { calls, posts, getConfig: () => config }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AiConfig — "Eliminar" (agent config, including the API key)', () => {
  it('clicking "Eliminar" does NOT call DELETE — it only opens the confirmation dialog (TEST 1 / 2 / 8)', async () => {
    const { calls } = mockFetchSequence()
    render(<AiConfig />)

    const removeButton = await screen.findByText('remove')
    fireEvent.click(removeButton)

    // The dialog must be open (first, non-critical screen) …
    expect(await screen.findByText('removeConfirmTitle')).toBeTruthy()
    // … and the click must NOT have triggered the DELETE endpoint —
    // the API key is still exactly as it was.
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('the full two-step confirmation deletes the config (and API key) exactly once', async () => {
    const { calls } = mockFetchSequence()
    render(<AiConfig />)

    fireEvent.click(await screen.findByText('remove'))
    // Step 1 → "Continue" only advances to step 2, still no DELETE.
    fireEvent.click(await screen.findByText('removeConfirmContinue'))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    // Step 2 names the API key explicitly before the user can proceed.
    expect(await screen.findByText('removeCriticalItemApiKey')).toBeTruthy()

    fireEvent.click(await screen.findByText('removeCriticalConfirmButton'))
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'DELETE' && c.url === '/api/ai/config')).toHaveLength(1),
    )
  })

  it('Cancel at any step leaves the configuration untouched', async () => {
    const { calls } = mockFetchSequence()
    render(<AiConfig />)

    fireEvent.click(await screen.findByText('remove'))
    fireEvent.click(await screen.findByText('removeConfirmCancel'))

    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    // The dialog is gone.
    expect(screen.queryByText('removeConfirmTitle')).toBeNull()
  })

  it('a failed DELETE does not clear the configured state — the button is still there to retry', async () => {
    const { calls } = mockFetchSequence(false)
    render(<AiConfig />)

    fireEvent.click(await screen.findByText('remove'))
    fireEvent.click(await screen.findByText('removeConfirmContinue'))
    fireEvent.click(await screen.findByText('removeCriticalConfirmButton'))

    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
    // Error surfaced, dialog stayed open — proven generically in
    // destructive-confirm-dialog.test.tsx; here we only need to know
    // the "Eliminar" trigger is still present (i.e. removal was NOT
    // optimistically applied to local state on a failed delete).
    expect(await screen.findByText('remove')).toBeTruthy()
  })
})

// ============================================================
// "Business context & instructions" (ai_configs.system_prompt) — AI
// optimization project, Fase 2 (blindaje de instrucciones del agente
// interno). This field never had its save/load round trip tested
// before; only the unrelated "Eliminar" flow above was covered.
// ============================================================
describe('AiConfig — "Business context & instructions" (system_prompt)', () => {
  it('loads the existing instructions from GET into the textarea', async () => {
    mockFetchSequence()
    render(<AiConfig />)

    const textarea = (await screen.findByLabelText('businessContext')) as HTMLTextAreaElement
    expect(textarea.value).toBe('Be helpful.')
  })

  it('editing and saving sends a request containing exactly the new system_prompt, and the text stays visible after saving', async () => {
    const backend = mockFetchSequence()
    render(<AiConfig />)

    const textarea = (await screen.findByLabelText('businessContext')) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Somos una ferretería. Sé breve y cordial.' } })
    fireEvent.click(screen.getByText('save'))

    await waitFor(() => expect(backend.posts).toHaveLength(1))
    expect(backend.posts[0].system_prompt).toBe('Somos una ferretería. Sé breve y cordial.')
    // Every other field the form knows about travels in the same
    // request (this route has no partial-update contract) — but
    // specifically confirm system_prompt is exactly what was typed,
    // not trimmed/altered/dropped.
    expect(backend.getConfig()?.system_prompt).toBe('Somos una ferretería. Sé breve y cordial.')
    await waitFor(() => expect(textarea.value).toBe('Somos una ferretería. Sé breve y cordial.'))
  })

  it('survives an unmount/remount (reload), reading the saved instructions back from a fresh GET', async () => {
    const backend = mockFetchSequence()
    render(<AiConfig />)

    const textarea = (await screen.findByLabelText('businessContext')) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Instrucciones actualizadas.' } })
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(backend.posts).toHaveLength(1))

    cleanup()
    render(<AiConfig />)
    const reloadedTextarea = (await screen.findByLabelText('businessContext')) as HTMLTextAreaElement
    expect(reloadedTextarea.value).toBe('Instrucciones actualizadas.')
  })

  it('clearing the field to empty text saves it as null (existing clear-the-field behavior)', async () => {
    const backend = mockFetchSequence()
    render(<AiConfig />)

    const textarea = (await screen.findByLabelText('businessContext')) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '' } })
    fireEvent.click(screen.getByText('save'))

    await waitFor(() => expect(backend.posts).toHaveLength(1))
    expect(backend.posts[0].system_prompt).toBeNull()
    expect(backend.getConfig()?.system_prompt).toBeNull()
    await waitFor(() => expect(textarea.value).toBe(''))
  })

  it('a failed save shows an error and does NOT clear the text the user typed', async () => {
    mockFetchSequence()
    render(<AiConfig />)
    const textarea = (await screen.findByLabelText('businessContext')) as HTMLTextAreaElement
    // The real initial load already resolved above via the default
    // fetch stub; now install a mock that only fails the POST.
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (String(url) === '/api/ai/config' && method === 'POST') {
        return new Response(JSON.stringify({ error: 'Could not validate the API key with the provider.' }), { status: 400 })
      }
      return new Response(JSON.stringify({ configured: true, ...DEFAULT_CONFIG }), { status: 200 })
    }))

    fireEvent.change(textarea, { target: { value: 'Texto que el usuario escribió y no debe perderse.' } })
    fireEvent.click(screen.getByText('save'))

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Could not validate the API key with the provider.'),
    )
    // The failed save must not have triggered a refetch that would
    // overwrite the user's unsaved text with the old server value.
    expect(textarea.value).toBe('Texto que el usuario escribió y no debe perderse.')
  })
})
