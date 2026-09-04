// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ============================================================
// AI Agents Setup → Knowledge Base document delete — destructive-
// action confirmation security fix. Before this fix the trash icon on
// each document row called DELETE /api/ai/knowledge/{id} with ZERO
// confirmation of any kind (not even window.confirm) — this file pins
// that a click now only opens a confirmation dialog.
// ============================================================

// Stable function reference across renders, matching real next-intl's
// own internal memoization (see data-sources-settings.test.tsx for why
// a fresh closure per render would be observably wrong).
const translate = (key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key
vi.mock('next-intl', () => ({
  useTranslations: () => translate,
}))

import { AiKnowledgeCard } from './ai-knowledge'

const DOCS_RESPONSE = {
  documents: [
    { id: 'doc-1', title: 'Return policy', updated_at: '2026-01-01', type: 'manual', metadata: null },
  ],
}

function mockFetchSequence(deleteOk = true) {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({ url: String(url), method })
      if (String(url) === '/api/ai/knowledge' && method === 'GET') {
        return new Response(JSON.stringify(DOCS_RESPONSE), { status: 200 })
      }
      if (String(url) === '/api/ai/knowledge/doc-1' && method === 'DELETE') {
        // No `error` field on failure so the code falls back to
        // t('removeFailed') — asserted below via the mocked
        // useTranslations, which returns the key itself.
        return deleteOk
          ? new Response(JSON.stringify({ success: true }), { status: 200 })
          : new Response(JSON.stringify({}), { status: 500 })
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

describe('AiKnowledgeCard — deleting a knowledge-base document', () => {
  it('clicking the trash icon does NOT call DELETE — it only opens the confirmation dialog (TEST 1 / 2)', async () => {
    const calls = mockFetchSequence()
    render(<AiKnowledgeCard accountId="acct-1" canEdit={true} hasEmbeddingsKey={false} />)

    const deleteButton = await screen.findByTitle('Delete')
    fireEvent.click(deleteButton)

    expect(await screen.findByText('deleteDocConfirmTitle')).toBeTruthy()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('confirming deletes the document exactly once', async () => {
    const calls = mockFetchSequence()
    render(<AiKnowledgeCard accountId="acct-1" canEdit={true} hasEmbeddingsKey={false} />)

    fireEvent.click(await screen.findByTitle('Delete'))
    fireEvent.click(await screen.findByText('deleteDocConfirmButton'))

    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'DELETE' && c.url === '/api/ai/knowledge/doc-1')).toHaveLength(1),
    )
    // The row is gone from the list once the delete actually succeeded.
    await waitFor(() => expect(screen.queryByText('Return policy')).toBeNull())
  })

  it('Cancel leaves the document in place — no DELETE call', async () => {
    const calls = mockFetchSequence()
    render(<AiKnowledgeCard accountId="acct-1" canEdit={true} hasEmbeddingsKey={false} />)

    fireEvent.click(await screen.findByTitle('Delete'))
    fireEvent.click(await screen.findByText('deleteDocConfirmCancel'))

    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(screen.getByText('Return policy')).toBeTruthy()
  })

  it('a failed delete keeps the document visible — no optimistic removal on error', async () => {
    mockFetchSequence(false)
    render(<AiKnowledgeCard accountId="acct-1" canEdit={true} hasEmbeddingsKey={false} />)

    fireEvent.click(await screen.findByTitle('Delete'))
    fireEvent.click(await screen.findByText('deleteDocConfirmButton'))

    await waitFor(() => expect(screen.getByText('removeFailed')).toBeTruthy())
    expect(screen.getByText('Return policy')).toBeTruthy()
  })
})
