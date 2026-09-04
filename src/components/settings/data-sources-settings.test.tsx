// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ============================================================
// AI Agents Setup → Fuentes de Datos → "Eliminar" — destructive-action
// confirmation security fix. Before this fix the row's delete button
// used a raw window.confirm() (Fase 7 of the security pass explicitly
// forbids that); this file pins that it now goes through the project's
// own Dialog-based DestructiveConfirmDialog and that the first click
// never itself calls DELETE.
// ============================================================

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'acct-1',
    accountRole: 'admin',
    profileLoading: false,
    defaultCurrency: 'USD',
  }),
}))

// Stable function reference across renders — real next-intl memoizes
// its translator internally, and DataSourcesSettings' `load` is a
// useCallback keyed on `t`; a fresh closure every render (a naive
// inline mock) would break that memoization and re-fire the initial
// GET on every render, which is exactly what real next-intl does not do.
const translate = (key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key
vi.mock('next-intl', () => ({
  useTranslations: () => translate,
}))

vi.mock('./data-source-preview-dialog', () => ({ DataSourcePreviewDialog: () => null }))

import { DataSourcesSettings } from './data-sources-settings'

const SOURCES_RESPONSE = {
  data_sources: [
    {
      id: 'src-1',
      source_type: 'google_sheets',
      display_name: 'Catálogo principal',
      source_url: 'https://docs.google.com/x',
      source_filename: null,
      usage: 'catalog',
      status: 'active',
      priority: 100,
      is_primary: true,
      fallback_policy: 'fallback_on_not_found',
      currency: 'USD',
      row_count: 809,
      last_synced_at: null,
      last_error: null,
    },
  ],
}

function mockFetchSequence(deleteOk = true) {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({ url: String(url), method })
      if (String(url) === '/api/ai/data-sources' && method === 'GET') {
        return new Response(JSON.stringify(SOURCES_RESPONSE), { status: 200 })
      }
      if (String(url) === '/api/ai/data-sources/src-1' && method === 'DELETE') {
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

describe('DataSourcesSettings — "Eliminar" a data source', () => {
  it('clicking "delete" does NOT call DELETE — it only opens the confirmation dialog (TEST 1 / 2)', async () => {
    const calls = mockFetchSequence()
    render(<DataSourcesSettings />)

    fireEvent.click(await screen.findByText('delete'))

    expect(await screen.findByText('deleteConfirmTitle')).toBeTruthy()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('confirming deletes the source exactly once', async () => {
    const calls = mockFetchSequence()
    render(<DataSourcesSettings />)

    fireEvent.click(await screen.findByText('delete'))
    fireEvent.click(await screen.findByText('deleteConfirmButton'))

    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'DELETE' && c.url === '/api/ai/data-sources/src-1')).toHaveLength(1),
    )
    await waitFor(() => expect(screen.queryByText('Catálogo principal')).toBeNull())
  })

  it('Cancel leaves the data source in place — no DELETE call', async () => {
    const calls = mockFetchSequence()
    render(<DataSourcesSettings />)

    fireEvent.click(await screen.findByText('delete'))
    fireEvent.click(await screen.findByText('deleteConfirmCancel'))

    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(screen.getByText('Catálogo principal')).toBeTruthy()
  })

  it('a failed delete keeps the source visible — no optimistic removal on error', async () => {
    mockFetchSequence(false)
    render(<DataSourcesSettings />)

    fireEvent.click(await screen.findByText('delete'))
    fireEvent.click(await screen.findByText('deleteConfirmButton'))

    await waitFor(() => expect(screen.getByText('deleteFailed')).toBeTruthy())
    expect(screen.getByText('Catálogo principal')).toBeTruthy()
  })
})
