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
vi.mock('@/lib/account/members', () => ({
  fetchAccountMembers: vi.fn().mockResolvedValue([]),
  memberLabel: (m: { user_id: string }) => m.user_id,
}))

import { AiConfig } from './ai-config'

const CONFIGURED_RESPONSE = {
  configured: true,
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

function mockFetchSequence(deleteOk = true) {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({ url: String(url), method })
      if (String(url) === '/api/ai/config' && method === 'GET') {
        return new Response(JSON.stringify(CONFIGURED_RESPONSE), { status: 200 })
      }
      if (String(url) === '/api/ai/config' && method === 'DELETE') {
        return deleteOk
          ? new Response(JSON.stringify({ success: true }), { status: 200 })
          : new Response(JSON.stringify({ error: 'Failed to delete AI configuration' }), { status: 500 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }),
  )
  return calls
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
    const calls = mockFetchSequence()
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
    const calls = mockFetchSequence()
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
    const calls = mockFetchSequence()
    render(<AiConfig />)

    fireEvent.click(await screen.findByText('remove'))
    fireEvent.click(await screen.findByText('removeConfirmCancel'))

    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    // The dialog is gone.
    expect(screen.queryByText('removeConfirmTitle')).toBeNull()
  })

  it('a failed DELETE does not clear the configured state — the button is still there to retry', async () => {
    const calls = mockFetchSequence(false)
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
