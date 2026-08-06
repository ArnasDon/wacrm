const REQUEST_TIMEOUT_MS = 10_000

interface NovyraSearchRow {
  document_id: string
  fragment_id: string
  title: string
  content: string
  publication_date: string | null
  original_uri: string | null
  discovery_source: string
  citation_source: string
  attribution_type: string
}

interface NovyraSession {
  access_token: string
  expires_at?: number
}

let cachedSession: NovyraSession | null = null

function configuration() {
  const url = process.env.NOVYRA_SUPABASE_URL?.replace(/\/$/, '')
  const anonKey = process.env.NOVYRA_SUPABASE_ANON_KEY
  const email = process.env.NOVYRA_CRM_USER_EMAIL
  const password = process.env.NOVYRA_CRM_USER_PASSWORD
  const agentCode = process.env.NOVYRA_AGENT_CODE
  const countryCode = process.env.NOVYRA_COUNTRY_CODE
  if (!url || !anonKey || !email || !password || !agentCode || !countryCode) return null
  return { url, anonKey, email, password, agentCode, countryCode }
}

async function accessToken(config: NonNullable<ReturnType<typeof configuration>>) {
  const now = Math.floor(Date.now() / 1000)
  if (cachedSession?.access_token && (cachedSession.expires_at ?? 0) > now + 60) {
    return cachedSession.access_token
  }

  const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.email, password: config.password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`NOVYRA authentication failed (${response.status})`)
  cachedSession = (await response.json()) as NovyraSession
  return cachedSession.access_token
}

async function searchNovyra(query: string, k: number): Promise<NovyraSearchRow[]> {
  const config = configuration()
  if (!config) throw new Error('NOVYRA server configuration is incomplete')

  const token = await accessToken(config)
  const response = await fetch(`${config.url}/rest/v1/rpc/search_knowledge_v1`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'novyra_api',
      'Accept-Profile': 'novyra_api',
    },
    body: JSON.stringify({
      p_agent_code: config.agentCode,
      p_query: query.trim(),
      p_country_code: config.countryCode,
      p_limit: Math.min(Math.max(k, 1), 10),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`NOVYRA search failed (${response.status})`)
  return (await response.json()) as NovyraSearchRow[]
}

export async function testNovyraKnowledgeConnection(): Promise<{
  resultCount: number
  message: string
}> {
  try {
    const rows = await searchNovyra('Moçambique economia notícias', 1)
    return {
      resultCount: rows.length,
      message: rows.length
        ? `Ligação válida. Consulta concluída com ${rows.length} resultado.`
        : 'Ligação válida. A consulta foi executada sem resultados.',
    }
  } catch (error) {
    cachedSession = null
    throw error
  }
}

export async function retrieveNovyraKnowledge(query: string, k = 5): Promise<string[]> {
  if (!query.trim() || k <= 0) return []

  try {
    const rows = await searchNovyra(query, k)
    return rows.map((row) =>
      [
        `Noticia: ${row.title}`,
        `Data: ${row.publication_date || 'nao indicada'}`,
        `Fonte a citar: ${row.citation_source}`,
        `Tipo de atribuicao: ${row.attribution_type}`,
        `Fonte de recolha (apenas proveniencia interna): ${row.discovery_source}`,
        `Ligacao: ${row.original_uri || 'nao disponivel'}`,
        `Evidencia: ${row.content}`,
      ].join('\n'),
    )
  } catch (error) {
    cachedSession = null
    console.error('[novyra knowledge] unavailable; continuing with local knowledge:', error)
    return []
  }
}
