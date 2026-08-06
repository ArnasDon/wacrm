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
  if (!url || !anonKey || !email || !password) return null
  return { url, anonKey, email, password }
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

export async function retrieveNovyraKnowledge(query: string, k = 5): Promise<string[]> {
  const config = configuration()
  if (!config || !query.trim() || k <= 0) return []

  try {
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
        p_agent_code: process.env.NOVYRA_AGENT_CODE || 'novura-news-whatsapp',
        p_query: query.trim(),
        p_country_code: process.env.NOVYRA_COUNTRY_CODE || 'MZ',
        p_limit: Math.min(k, 10),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`NOVYRA search failed (${response.status})`)

    const rows = (await response.json()) as NovyraSearchRow[]
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

