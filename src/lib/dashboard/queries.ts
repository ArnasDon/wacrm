import type { SupabaseClient } from '@supabase/supabase-js'
import {
  daysAgoStart,
  DOW_SHORT_MON_FIRST,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from './date-utils'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  PipelineStageSlice,
  ResponseTimeBucket,
  ResponseTimeSummary,
} from './types'
import { nomeDoContato } from '@/lib/contacts/identidade'
import { buscarPaginado } from '@/lib/supabase/paginar'

// ------------------------------------------------------------
// All client-side aggregation. RLS scopes every query to the
// signed-in user automatically, so we never pass user_id explicitly
// here. Perf is acceptable for the current scale (low thousands of
// messages) — if a tenant's dataset outgrows this, we'd migrate the
// heavy aggregations to SQL RPCs. Noted in the PR.
// ------------------------------------------------------------

type DB = SupabaseClient

// ------------------------------------------------------------
// FILTRO POR CANAL — o que dá e o que NÃO dá para recortar.
//
// `conversations`, `messages`, `broadcasts` e `automation_logs` têm
// `channel_id` desde as migrations 902/903. `deals` ganhou o seu na 908.
// `contacts` e `pipeline_stages` continuam sem, e nem faria sentido: um
// contato pertence ao escritório, não a um número, e uma etapa é do funil.
//
// ⚠️ EM `deals` O RECORTE TEM OUTRO SIGNIFICADO, e a tela precisa dizê-lo.
// `deals.channel_id` é carimbado no NASCIMENTO do card, pelo roteador de
// entrada (e pelo passo de automação). Ele responde "por qual número este
// cliente CHEGOU", não "quanto este número tem em aberto agora" — o negócio
// segue vivo mesmo que a conversa migre para outro número depois. Daí a
// etiqueta ser "Originados neste número", e não "Conta inteira".
// Negócio criado à mão no formulário fica com a coluna NULA e, portanto,
// fora de qualquer recorte por canal.
//
// Por isso o filtro continua PARCIAL, e a tela precisa dizer quais cartões
// ele não alcança. Um número da conta inteira exibido sob um filtro de canal
// seria lido como "isto é do Comercial" — a mentira mais cara que um painel
// pode contar.
// ------------------------------------------------------------

/**
 * Aplica `channel_id = X` quando há filtro; devolve a query intacta se não.
 *
 * `Q` fica SEM constraint de propósito: escrever `Q extends { eq(...): Q }`
 * é auto-referente e faz o compilador estourar com TS2589 ("type
 * instantiation is excessively deep") no builder do PostgREST, que já é
 * profundamente genérico. O cast local resolve sem contaminar o tipo de
 * retorno — quem chama continua recebendo o builder original.
 */
export function porCanal<Q>(query: Q, channelId?: string | null): Q {
  if (!channelId) return query
  return (query as { eq: (coluna: string, valor: string) => Q }).eq(
    'channel_id',
    channelId,
  )
}

// ------------------------------------------------------------
// OS NEGÓCIOS ABERTOS — a única leitura do painel que traz LINHAS em volume.
//
// ⚠️⚠️ As duas consultas de `deals` do painel (o cartão "Valor dos negócios
// abertos" e a rosca por etapa) liam sem `range` e sem `count`. O PostgREST
// corta em ~1000 linhas SEM AVISAR: volta `error: null`, mil linhas e cara de
// completa. Hoje a conta tem 976 negócios e o defeito não aparece; a carga da
// Kommo traz ~12.700 de uma vez (`docs/PLANO-migracao-kommo.md`), e a partir
// desse dia o cartão somaria MIL negócios arbitrários e publicaria o resultado
// como total — número plausível, estável entre recarregamentos e MENOR que a
// verdade. É a pior categoria de erro de painel: ninguém desconfia dele.
//
// `linhas: null` = NÃO SABEMOS, e quem chama tem de esconder o número. Soma
// parcial apresentada como total é exatamente o que isto existe para impedir.
//
// 🔭 O certo seria AGREGAR NO BANCO: o painel não precisa das linhas, precisa
// de `sum(value)` e `count(*)` por etapa. Isso pede migration (uma RPC) e
// ficou de fora — hoje o painel baixa a mesma coleção DUAS vezes por carga,
// porque o cartão e a rosca são duas chamadas independentes na página.
// ------------------------------------------------------------

function lerNegociosAbertos<T>(db: DB, colunas: string, channelId?: string | null) {
  return buscarPaginado<T>(async (de, ate) => {
    const { data, error, count } = await porCanal(
      db.from('deals').select(colunas, { count: 'exact' }).eq('status', 'open'),
      channelId,
    )
      // ⚠️ A ordem aqui NÃO é de exibição — nada nesta leitura é exibido em
      // ordem, tudo vira soma. Ela existe porque `range` sem `order` é
      // LIMIT/OFFSET sobre ordem INDEFINIDA: uma linha que troca de posição
      // entre duas páginas vem duas vezes numa e some da outra, e a soma sai
      // errada sem erro nenhum. `id` é único, então desempata sozinho (o
      // quadro do funil precisa somar `id` ao `created_at` justamente porque
      // lá a ordem TAMBÉM é a da tela).
      .order('id', { ascending: true })
      .range(de, ate)
    return { data: (data ?? null) as T[] | null, error, count }
  })
}

/** O erro do Supabase tem propriedades NÃO enumeráveis — logar campo a campo. */
function registrarLeituraDuvidosa(
  onde: string,
  resultado: {
    motivo: string | null
    erro: {
      message: string
      details?: string | null
      hint?: string | null
      code?: string | null
    } | null
  },
) {
  console.error(`[dashboard] ${onde}: leitura de negócios não confiável`, {
    motivo: resultado.motivo,
    message: resultado.erro?.message,
    details: resultado.erro?.details,
    hint: resultado.erro?.hint,
    code: resultado.erro?.code,
  })
}

// ------------------------------------------------------------
// GRUPOS FORA DO PAINEL
//
// O painel fala de ATENDIMENTO 1:1. Um grupo ativo tem 10–50× o tráfego de
// uma conversa: deixá-lo entrar sequestra "mensagens hoje", a série e o tempo
// médio de resposta. Pior, a atividade recente lê `conversations.contacts` —
// que em grupo é NULL — e viraria uma lista de linhas sem nome.
//
// Em `conversations` o filtro é direto: `.is('group_id', null)`, escrito no
// próprio call site porque é auto-explicativo.
//
// Em `messages` NÃO existe a coluna — o recorte tem que ir pelo pai, e no
// PostgREST isso são DUAS peças que andam juntas:
//   1. o embed EMBED_SEM_GRUPO no `.select(...)`, e
//   2. o `semGrupo(...)` na query.
// Sem o embed `!inner` o filtro não recorta nada. Por isso as duas moram aqui
// lado a lado: quem copiar uma lembra da outra.
// ------------------------------------------------------------

/** Vai no `.select(...)` de toda consulta a `messages` que passe por `semGrupo`. */
const EMBED_SEM_GRUPO = 'conversations!inner(group_id)'

/** Descarta mensagens cuja conversa é de grupo. Exige EMBED_SEM_GRUPO no select. */
function semGrupo<Q>(query: Q): Q {
  return (query as { is: (coluna: string, valor: null) => Q }).is(
    'conversations.group_id',
    null,
  )
}

// --- 1. Metric cards ---------------------------------------------------

export async function loadMetrics(
  db: DB,
  channelId?: string | null,
): Promise<MetricsBundle> {
  const todayStart = startOfLocalDay().toISOString()
  const yesterdayStart = daysAgoStart(1).toISOString()

  const [
    openConvCur,
    newConvToday,
    newConvYesterday,
    newContactsToday,
    newContactsYesterday,
    openDeals,
    messagesToday,
    messagesYesterday,
  ] = await Promise.all([
    porCanal(
      db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .is('group_id', null),
      channelId,
    ),
    porCanal(
      db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .is('group_id', null)
        .gte('created_at', todayStart),
      channelId,
    ),
    porCanal(
      db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .is('group_id', null)
        .gte('created_at', yesterdayStart)
        .lt('created_at', todayStart),
      channelId,
    ),
    db.from('contacts').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', yesterdayStart)
      .lt('created_at', todayStart),
    lerNegociosAbertos<{ value: number | null }>(db, 'value', channelId),
    porCanal(
      semGrupo(
        db
          .from('messages')
          .select(`id, ${EMBED_SEM_GRUPO}`, { count: 'exact', head: true })
          .eq('sender_type', 'agent')
          .gte('created_at', todayStart),
      ),
      channelId,
    ),
    porCanal(
      semGrupo(
        db
          .from('messages')
          .select(`id, ${EMBED_SEM_GRUPO}`, { count: 'exact', head: true })
          .eq('sender_type', 'agent')
          .gte('created_at', yesterdayStart)
          .lt('created_at', todayStart),
      ),
      channelId,
    ),
  ])

  // As sete consultas de CONTAGEM acima devolvem `{ count, data, error }` sem
  // lançar, e o código só lia `count ?? 0`. Uma falha virava CARTÃO ZERADO: o
  // painel afirmava "0 conversas ativas" quando na verdade a consulta nem
  // respondeu. Zero é um número plausível — ninguém desconfia dele. Agora a
  // falha sobe e o chamador registra o erro em vez de mostrar mentira.
  const falha = [
    openConvCur,
    newConvToday,
    newConvYesterday,
    newContactsToday,
    newContactsYesterday,
    messagesToday,
    messagesYesterday,
  ].find((r) => r.error)
  if (falha?.error) throw falha.error

  // ⚠️ A leitura de negócios NÃO entra naquela lista, e a diferença é
  // deliberada: as sete acima são `count/head` (uma linha de resposta, ou
  // falha), enquanto esta percorre milhares de linhas e tem um terceiro
  // estado — "veio incompleta". Derrubar a função aqui apagaria os TRÊS
  // cartões que estão certos por causa do quarto. O quarto admite que não
  // sabe; os outros continuam na tela.
  if (!openDeals.linhas) registrarLeituraDuvidosa('cartão de negócios', openDeals)
  const negociosAbertos = openDeals.linhas && {
    value: openDeals.linhas.reduce((soma, d) => soma + (d.value ?? 0), 0),
    count: openDeals.linhas.length,
  }

  return {
    activeConversations: {
      current: openConvCur.count ?? 0,
      // "vs yesterday" on a current-state count has no clean answer
      // without snapshots — we show the delta in NEW open conversations
      // today vs yesterday. That's the business-meaningful daily signal.
      previous: (newConvToday.count ?? 0) - (newConvYesterday.count ?? 0),
    },
    newContactsToday: {
      current: newContactsToday.count ?? 0,
      previous: newContactsYesterday.count ?? 0,
    },
    openDeals: negociosAbertos,
    messagesSentToday: {
      current: messagesToday.count ?? 0,
      previous: messagesYesterday.count ?? 0,
    },
  }
}

// --- 2. Conversations over time ---------------------------------------

export async function loadConversationsSeries(
  db: DB,
  rangeDays: number,
  channelId?: string | null,
): Promise<ConversationsSeriesPoint[]> {
  const start = daysAgoStart(rangeDays - 1).toISOString()
  const { data, error } = await porCanal(
    semGrupo(
      db
        .from('messages')
        .select(`created_at, sender_type, ${EMBED_SEM_GRUPO}`)
        .gte('created_at', start),
    ),
    channelId,
  ).order('created_at', { ascending: true })
  if (error) throw error

  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })

  for (const row of (data ?? []) as { created_at: string; sender_type: string }[]) {
    const key = localDayKey(row.created_at)
    const bucket = buckets.get(key)
    if (!bucket) continue
    if (row.sender_type === 'customer') bucket.incoming += 1
    else bucket.outgoing += 1 // agent + bot both count as outgoing
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }))
}

// --- 3. Pipeline donut -------------------------------------------------

export async function loadPipelineDonut(
  db: DB,
  channelId?: string | null,
): Promise<PipelineDonutData> {
  const [stagesRes, dealsRes] = await Promise.all([
    // Etapas NÃO se filtram por canal: elas são do funil, não do número.
    // Também não paginam: são dezenas por conta, criadas à mão pelo operador
    // — a carga da Kommo traz NEGÓCIOS, não etapas.
    db.from('pipeline_stages').select('id, name, color, pipeline_id, position').order('position'),
    lerNegociosAbertos<{ stage_id: string; value: number | null }>(
      db,
      'stage_id, value',
      channelId,
    ),
  ])

  // ⚠️ Sem as etapas não há como NOMEAR fatia nenhuma, e o código antigo lia
  // `stagesRes.data ?? []`: a consulta que falhava virava rosca vazia, e a
  // rosca vazia diz "Nenhum negócio aberto ainda" — lista vazia virando
  // AFIRMAÇÃO, sobre uma conta que pode ter milhares de negócios em aberto.
  if (stagesRes.error) {
    console.error('[dashboard] rosca do funil: etapas não carregaram', {
      message: stagesRes.error.message,
      details: stagesRes.error.details,
      hint: stagesRes.error.hint,
      code: stagesRes.error.code,
    })
    return { confiavel: false }
  }
  if (!dealsRes.linhas) {
    registrarLeituraDuvidosa('rosca do funil', dealsRes)
    return { confiavel: false }
  }

  const stages =
    (stagesRes.data ?? []) as { id: string; name: string; color: string }[]
  const deals = dealsRes.linhas

  const byStage = new Map<string, { count: number; total: number }>()
  for (const d of deals) {
    const row = byStage.get(d.stage_id) ?? { count: 0, total: 0 }
    row.count += 1
    row.total += d.value ?? 0
    byStage.set(d.stage_id, row)
  }

  const slices: PipelineStageSlice[] = stages
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color || '#64748b',
      dealCount: byStage.get(s.id)?.count ?? 0,
      totalValue: byStage.get(s.id)?.total ?? 0,
    }))
    // Hide empty stages from the ring (but we'd still show them in the
    // legend if the user wanted a full breakdown — trimming keeps the
    // visual clean for the common case).
    .filter((s) => s.totalValue > 0 || s.dealCount > 0)

  return {
    confiavel: true,
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

// --- 4. Response time by day of week ----------------------------------

export async function loadResponseTime(
  db: DB,
  channelId?: string | null,
): Promise<ResponseTimeSummary> {
  // Pull the last 14 days of messages in one shot, then walk per
  // conversation to find each "first inbound" → "first subsequent
  // outbound" pair. 14 days gives us both "this week" + "last week"
  // with enough overlap if the user opens the dashboard late on a
  // Monday.
  const fourteenDaysAgo = daysAgoStart(13).toISOString()
  const { data, error } = await porCanal(
    semGrupo(
      db
        .from('messages')
        .select(`conversation_id, sender_type, created_at, ${EMBED_SEM_GRUPO}`)
        .gte('created_at', fourteenDaysAgo),
    ),
    channelId,
  )
    .order('conversation_id', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error

  const rows = (data ?? []) as {
    conversation_id: string
    sender_type: string
    created_at: string
  }[]

  // Group per conversation, pair unreplied customer messages with the
  // next outbound message from the agent/bot. A single customer message
  // can only count once (avoids inflating averages if the customer
  // double-messages while the agent takes time to reply).
  interface Sample {
    customerAt: Date
    responseAt: Date
  }
  const samples: Sample[] = []

  let currentConv = ''
  let pendingCustomer: Date | null = null
  for (const row of rows) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomer = null
    }
    const ts = new Date(row.created_at)
    if (row.sender_type === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      samples.push({ customerAt: pendingCustomer, responseAt: ts })
      pendingCustomer = null
    }
  }

  const now = new Date()
  const thisWeekStart = daysAgoStart(mondayIndex(now))
  const lastWeekStart = daysAgoStart(mondayIndex(now) + 7)

  // Per-day-of-week buckets, averaged over both weeks' worth of data
  // so each bar has more samples to stand on. If a day has no samples
  // its avgMinutes stays null and the chart renders the bar muted.
  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const thisWeekMins: number[] = []
  const lastWeekMins: number[] = []

  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    const dow = mondayIndex(s.customerAt)
    byDow.get(dow)!.push(diffMin)
    if (s.customerAt >= thisWeekStart) {
      thisWeekMins.push(diffMin)
    } else if (s.customerAt >= lastWeekStart && s.customerAt < thisWeekStart) {
      lastWeekMins.push(diffMin)
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  const buckets: ResponseTimeBucket[] = Array.from({ length: 7 }, (_, dow) => {
    const samples = byDow.get(dow) ?? []
    return {
      dow,
      avgMinutes: avg(samples),
      samples: samples.length,
    }
  })

  // Silence unused-label warnings — keep the arrays explicitly named
  // for readability above.
  void DOW_SHORT_MON_FIRST

  return {
    buckets,
    thisWeekAvg: avg(thisWeekMins),
    lastWeekAvg: avg(lastWeekMins),
  }
}

// --- 5. Activity feed --------------------------------------------------

export async function loadActivity(
  db: DB,
  limit = 20,
  channelId?: string | null,
): Promise<ActivityItem[]> {
  // Pull ~10 from each source (plenty of headroom after merge-sort),
  // then interleave by timestamp. The individual per-table limits
  // keep the payload small; the final limit is enforced after sort.
  //
  // Com filtro de canal, contatos e negócios saem do feed. Não é perda: um
  // contato criado não pertence a número nenhum, e mostrá-lo sob o recorte
  // "Comercial" o faria parecer originado ali.
  const semCanal = !channelId
  const [msgs, contacts, deals, broadcasts, autoLogs] = await Promise.all([
    porCanal(
      // `conversations` já era embutido aqui; vira `!inner` e ganha `group_id`
      // para o semGrupo poder recortar. Sem isso o feed listaria mensagem de
      // grupo com `contacts` NULL — uma linha sem nome nenhum na tela.
      semGrupo(
        db
          .from('messages')
          .select(
            'id, content_text, sender_type, created_at, conversation_id, conversations!inner(group_id, contact_id, contacts(name, phone))',
          )
          .eq('sender_type', 'customer'),
      ),
      channelId,
    )
      .order('created_at', { ascending: false })
      .limit(10),
    semCanal
      ? db
          .from('contacts')
          .select('id, name, phone, instagram_username, created_at')
          .order('created_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    // Negócios voltaram ao feed sob filtro: desde a 908 eles têm canal.
    // (`contacts` acima continua fora — contato não pertence a um número.)
    porCanal(
      db.from('deals').select('id, title, updated_at, stage:pipeline_stages(name)'),
      channelId,
    )
      .order('updated_at', { ascending: false })
      .limit(10),
    porCanal(
      db.from('broadcasts').select('id, name, status, total_recipients, created_at'),
      channelId,
    )
      .order('created_at', { ascending: false })
      .limit(5),
    porCanal(
      db
        .from('automation_logs')
        .select('id, trigger_event, status, created_at, automation:automations(name), contact:contacts(name, phone)'),
      channelId,
    )
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const items: ActivityItem[] = []

  // PostgREST returns nested selections as arrays by default, even when
  // the foreign key is 1:1. We normalise by taking [0] on each level.
  for (const m of (msgs.data ?? []) as unknown as Array<{
    id: string
    content_text: string | null
    created_at: string
    conversation_id: string
    conversations:
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }[]
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }
      | null
  }>) {
    const conv = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations
    const contact = Array.isArray(conv?.contacts) ? conv?.contacts[0] : conv?.contacts
    const who = contact?.name || contact?.phone || 'Unknown'
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: `New message from ${who}`,
      at: m.created_at,
      href: `/inbox?c=${m.conversation_id}`,
    })
  }

  for (const c of (contacts.data ?? []) as Array<{ id: string; name: string | null; phone: string | null; instagram_username?: string | null; created_at: string }>) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: `New contact: ${nomeDoContato(c, '—')}`,
      at: c.created_at,
      href: '/contacts',
    })
  }

  for (const d of (deals.data ?? []) as unknown as Array<{
    id: string
    title: string
    updated_at: string
    stage: { name: string }[] | { name: string } | null
  }>) {
    const stage = Array.isArray(d.stage) ? d.stage[0] : d.stage
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: stage?.name
        ? `Deal "${d.title}" in ${stage.name}`
        : `Deal "${d.title}" updated`,
      at: d.updated_at,
      href: '/pipelines',
    })
  }

  for (const b of (broadcasts.data ?? []) as Array<{
    id: string
    name: string
    status: string
    total_recipients: number
    created_at: string
  }>) {
    const label =
      b.status === 'sent'
        ? `sent to ${b.total_recipients} contacts`
        : `${b.status} (${b.total_recipients} recipients)`
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: `Broadcast "${b.name}" ${label}`,
      at: b.created_at,
      href: '/broadcasts',
    })
  }

  for (const l of (autoLogs.data ?? []) as unknown as Array<{
    id: string
    trigger_event: string
    status: string
    created_at: string
    automation: { name: string }[] | { name: string } | null
    contact: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null
  }>) {
    const automation = Array.isArray(l.automation) ? l.automation[0] : l.automation
    const contact = Array.isArray(l.contact) ? l.contact[0] : l.contact
    const who = contact?.name || contact?.phone || 'a contact'
    const autoName = automation?.name || 'Automation'
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text: `Automation "${autoName}" ${l.status === 'failed' ? 'failed for' : 'triggered for'} ${who}`,
      at: l.created_at,
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
