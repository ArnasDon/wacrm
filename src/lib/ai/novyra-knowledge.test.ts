import { afterEach, describe, expect, it, vi } from 'vitest'
import { retrieveNovyraKnowledge } from './novyra-knowledge'

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.NOVYRA_SUPABASE_URL
  delete process.env.NOVYRA_SUPABASE_ANON_KEY
  delete process.env.NOVYRA_CRM_USER_EMAIL
  delete process.env.NOVYRA_CRM_USER_PASSWORD
})

describe('retrieveNovyraKnowledge', () => {
  it('is disabled when credentials are absent', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await retrieveNovyraKnowledge('economia')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('formats the preferred citation separately from discovery provenance', async () => {
    process.env.NOVYRA_SUPABASE_URL = 'https://novyra.test'
    process.env.NOVYRA_SUPABASE_ANON_KEY = 'anon'
    process.env.NOVYRA_CRM_USER_EMAIL = 'crm@example.com'
    process.env.NOVYRA_CRM_USER_PASSWORD = 'secret'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', expires_at: 9_999_999_999 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{
          document_id: 'd', fragment_id: 'f', title: 'Taxa MIMO',
          content: 'O banco central reduziu a taxa.', publication_date: '2026-08-05',
          original_uri: 'https://example.test', discovery_source: 'Diario Economico',
          citation_source: 'Banco de Mocambique', attribution_type: 'official_primary',
        }],
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await retrieveNovyraKnowledge('taxa MIMO')
    expect(result[0]).toContain('Fonte a citar: Banco de Mocambique')
    expect(result[0]).toContain('Fonte de recolha (apenas proveniencia interna): Diario Economico')
  })
})
