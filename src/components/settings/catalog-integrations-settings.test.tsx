// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ============================================================
// AI Agents Setup → Integrations → "Eliminar" — destructive-action
// confirmation security fix. Removing a Catalog API integration also
// deletes its stored, encrypted application secret, so (per Fase 4/5
// of the security pass) this goes through the CRITICAL two-step flow
// — the credential must be named explicitly before it can be deleted.
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

import { CatalogIntegrationsSettings } from './catalog-integrations-settings'

const INTEGRATIONS_RESPONSE = {
  integrations: [
    {
      id: 'int-1',
      provider: 'budun',
      display_name: 'Budun ERP',
      base_url: 'https://erp.example.com',
      app_key: 'app-123',
      scopes: ['catalog:read'],
      status: 'active',
      is_primary: true,
      last_test_at: null,
      last_test_ok: null,
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
      if (String(url) === '/api/integrations/catalog' && method === 'GET') {
        return new Response(JSON.stringify(INTEGRATIONS_RESPONSE), { status: 200 })
      }
      if (String(url) === '/api/integrations/catalog/int-1' && method === 'DELETE') {
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

describe('CatalogIntegrationsSettings — "Eliminar" (also deletes the stored secret)', () => {
  it('clicking "remove" does NOT call DELETE — it only opens the first confirmation screen (TEST 1 / 2 / 8)', async () => {
    const calls = mockFetchSequence()
    render(<CatalogIntegrationsSettings />)

    fireEvent.click(await screen.findByText('remove'))

    expect(await screen.findByText('removeConfirmTitle')).toBeTruthy()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('the first screen\'s "Continue" does NOT delete either — only the second screen does (TEST 7)', async () => {
    const calls = mockFetchSequence()
    render(<CatalogIntegrationsSettings />)

    fireEvent.click(await screen.findByText('remove'))
    fireEvent.click(await screen.findByText('removeConfirmContinue'))

    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    // The credential is named explicitly before the final confirm.
    expect(await screen.findByText('removeCriticalItemSecret')).toBeTruthy()
  })

  it('the full two-step confirmation deletes the integration (and its secret) exactly once', async () => {
    const calls = mockFetchSequence()
    render(<CatalogIntegrationsSettings />)

    fireEvent.click(await screen.findByText('remove'))
    fireEvent.click(await screen.findByText('removeConfirmContinue'))
    fireEvent.click(await screen.findByText('removeCriticalConfirmButton'))

    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'DELETE' && c.url === '/api/integrations/catalog/int-1')).toHaveLength(1),
    )
    await waitFor(() => expect(screen.queryByText('Budun ERP')).toBeNull())
  })

  it('Cancel at either step leaves the integration (and its secret) untouched', async () => {
    const calls = mockFetchSequence()
    render(<CatalogIntegrationsSettings />)

    fireEvent.click(await screen.findByText('remove'))
    fireEvent.click(await screen.findByText('removeConfirmCancel'))

    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(screen.getByText('Budun ERP')).toBeTruthy()
  })

  it('a failed delete keeps the integration visible — no optimistic removal on error', async () => {
    mockFetchSequence(false)
    render(<CatalogIntegrationsSettings />)

    fireEvent.click(await screen.findByText('remove'))
    fireEvent.click(await screen.findByText('removeConfirmContinue'))
    fireEvent.click(await screen.findByText('removeCriticalConfirmButton'))

    await waitFor(() => expect(screen.getByText('removeFailed')).toBeTruthy())
    expect(screen.getByText('Budun ERP')).toBeTruthy()
  })
})
