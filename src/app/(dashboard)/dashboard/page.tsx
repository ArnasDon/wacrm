"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { formatCurrency } from '@/lib/currency'
import {
  MessageSquare,
  UserPlus,
  DollarSign,
  Send,
} from 'lucide-react'

import {
  loadActivity,
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
} from '@/lib/dashboard/queries'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'

import { useTranslations } from 'next-intl'
import { ChannelFilter } from '@/components/channels/channel-filter'
import { useChannels } from '@/hooks/use-channels'

type RangeDays = 7 | 30 | 90

export default function DashboardPage() {
  const t = useTranslations('Dashboard.page')
  const tCanais = useTranslations('Channels')
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [range, setRange] = useState<RangeDays>(30)
  // O intervalo aberto, num ref, para `loadAll` recarregar o que está na
  // tela sem passar a depender de `range` — se dependesse, trocar de
  // intervalo dispararia a carga INTEIRA (métricas, funil, atividade) em
  // vez de só a série, e o cache por intervalo perderia a razão de existir.
  const rangeRef = useRef<RangeDays>(30)
  useEffect(() => {
    rangeRef.current = range
  }, [range])
  // Keep a cache per range so switching tabs doesn't re-fetch what we
  // already have. Ranges the user hasn't opened yet stay null and
  // trigger a fetch on first view.
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: null,
    90: null,
  })
  const [seriesLoading, setSeriesLoading] = useState(true)

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  // Filtro de canal. `null` = conta inteira, exatamente o painel de antes.
  // ⚠️ O filtro continua PARCIAL: `contacts` e `pipeline_stages` não têm
  // `channel_id`, e nem faria sentido — contato é do escritório, etapa é do
  // funil. Esses cartões ganham a marca "conta inteira".
  // ⚠️ `deals` TEM canal desde a 908, mas o significado é outro: a coluna é
  // carimbada no NASCIMENTO do card, então o recorte responde "quanto ENTROU
  // por este número". Por isso a marca ali é "Originados neste número".
  // Mostrar qualquer um dos dois sem ressalva seria pior do que não filtrar.
  const { channels } = useChannels()
  const [canalFiltro, setCanalFiltro] = useState<string | null>(null)

  // Geração da carga. Trocar de canal duas vezes rápido deixa DUAS cargas
  // no ar; sem este contador, a mais lenta (do canal anterior) podia chegar
  // por último e sobrescrever a tela com os números do canal errado — sem
  // nenhum sinal de que aquilo é de outro número.
  const geracaoRef = useRef(0)

  const loadAll = useCallback(() => {
    const db = createClient()
    geracaoRef.current += 1
    const geracao = geracaoRef.current
    const atual = () => geracao === geracaoRef.current

    // Kick everything off in parallel. Each block has its own
    // setState + finally so a slow query doesn't hold up faster
    // sections — each widget shows its own skeleton independently.
    void loadMetrics(db, canalFiltro)
      .then((m) => atual() && setMetrics(m))
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => atual() && setMetricsLoading(false))

    // O intervalo VISÍVEL, não 30 fixo. Enquanto isto só rodava na
    // montagem, 30 era sempre o intervalo aberto; agora que roda a cada
    // troca de canal, quem estivesse em "7 dias" ficava com o gráfico
    // preso no esqueleto para sempre — o cache tinha sido limpo e o único
    // intervalo recarregado era o errado.
    void loadConversationsSeries(db, rangeRef.current, canalFiltro)
      .then((s) => atual() && setSeries((prev) => ({ ...prev, [rangeRef.current]: s })))
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => atual() && setSeriesLoading(false))

    void loadPipelineDonut(db, canalFiltro)
      .then((p) => atual() && setPipeline(p))
      .catch((err) => console.error('[dashboard] pipeline failed:', err))
      .finally(() => atual() && setPipelineLoading(false))

    void loadResponseTime(db, canalFiltro)
      .then((r) => atual() && setResponseTime(r))
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => atual() && setResponseTimeLoading(false))

    // Fetch up to 50 so the biggest page-size option in the feed
    // (50 rows) is already in memory — switching sizes then becomes
    // a pure client-side slice with no extra round trip.
    void loadActivity(db, 50, canalFiltro)
      .then((a) => atual() && setActivity(a))
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => atual() && setActivityLoading(false))
  }, [canalFiltro])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Range switch handler — kept in an event callback (not an effect)
  // so the setState calls stay out of the react-hooks/set-state-in-effect
  // rule's way. The cached bucket check means switching back to a
  // previously-viewed range is instant and doesn't re-fetch.
  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      setRange(r)
      if (series[r] !== null) return
      setSeriesLoading(true)
      const db = createClient()
      loadConversationsSeries(db, r, canalFiltro)
        .then((s) => setSeries((prev) => ({ ...prev, [r]: s })))
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false))
    },
    [series, canalFiltro],
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('description')}
          </p>
        </div>
        <ChannelFilter
          channels={channels}
          value={canalFiltro}
          onChange={(id) => {
            setCanalFiltro(id)
            // Troca de canal invalida TODO o cache de séries: os pontos em
            // memória são do recorte anterior. Sem isto, alternar o filtro
            // e voltar para um intervalo já visto mostraria o gráfico do
            // canal errado, sem nenhum sinal na tela.
            setSeries({ 7: null, 30: null, 90: null })
            setMetricsLoading(true)
            setSeriesLoading(true)
            setResponseTimeLoading(true)
            setActivityLoading(true)
            // A rosca passou a recarregar com o filtro (908 deu canal a deals).
            // Sem este esqueleto ela exibiria os números do canal anterior
            // como se fossem do novo, sem nenhum sinal de que está velha.
            setPipelineLoading(true)
          }}
        />
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t('activeConversations')}
              value={metrics.activeConversations.current.toLocaleString()}
              icon={MessageSquare}
              delta={{
                sign: metrics.activeConversations.previous,
                label: deltaLabel(
                  metrics.activeConversations.previous, 
                  t('newTodayVsYesterday'), 
                  t('noChange', { suffix: t('newTodayVsYesterday') })
                ),
              }}
            />
            <MetricCard
              accountWideNote={canalFiltro ? tCanais('accountWide') : undefined}
              title={t('newContactsToday')}
              value={metrics.newContactsToday.current.toLocaleString()}
              icon={UserPlus}
              delta={{
                sign:
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                label: deltaLabel(
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                  t('vsYesterday'),
                  t('noChange', { suffix: t('vsYesterday') })
                ),
              }}
            />
            <MetricCard
              // "Originados neste número", não "Conta inteira": desde a 908 o
              // cartão RESPEITA o filtro, mas o canal do negócio é do
              // nascimento do card — é quanto entrou por aqui, não o total
              // que este número tem em aberto.
              accountWideNote={canalFiltro ? tCanais('channelOriginated') : undefined}
              title={t('openDealsValue')}
              // ⚠️ `openDeals` nulo é "não sabemos", nunca zero: a leitura dos
              // negócios pode voltar incompleta, e um valor somado pela
              // metade é indistinguível de um valor verdadeiro na tela.
              value={
                metrics.openDeals ? formatCurrency(metrics.openDeals.value) : '—'
              }
              icon={DollarSign}
              subtitle={
                metrics.openDeals
                  ? t('openDeals', { count: metrics.openDeals.count })
                  : t('openDealsUnknown')
              }
            />
            <MetricCard
              title={t('messagesSentToday')}
              value={metrics.messagesSentToday.current.toLocaleString()}
              icon={Send}
              delta={{
                sign:
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                label: deltaLabel(
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                  t('vsYesterday'),
                  t('noChange', { suffix: t('vsYesterday') })
                ),
              }}
            />
          </>
        )}
      </div>

      {/* Quick actions */}
      <QuickActions />

      {/* Charts row */}
      {/* items-stretch (the grid default) stretches the two columns to
          match the tallest sibling; adding h-full on each wrapper and
          on the inner panels makes both cards actually fill that
          stretched height so their rounded borders line up. Without
          this, the pipeline card rendered at its natural (shorter)
          height while the line chart drove the row height. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-full lg:col-span-3">
          <ConversationsChart
            series={series}
            loading={seriesLoading}
            range={range}
            onRangeChange={handleRangeChange}
          />
        </div>
        {/* A rosca agora recorta por canal — mas o significado é OUTRO: o
            canal do negócio é carimbado no NASCIMENTO do card, então isto
            responde "quanto ENTROU por este número", não "quanto este número
            tem em aberto". Negócio criado à mão fica sem canal e some do
            recorte. Daí a marca "Originados neste número". */}
        <div className="relative h-full lg:col-span-2">
          {canalFiltro && (
            <span className="absolute right-4 top-4 z-10 rounded border border-border bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {tCanais('channelOriginated')}
            </span>
          )}
          <PipelineDonut
            data={pipeline}
            loading={pipelineLoading}
          />
        </div>
      </div>

      {/* Response time */}
      <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />

      {/* Activity feed */}
      <ActivityFeed items={activity} loading={activityLoading} />
    </div>
  )
}

// ------------------------------------------------------------

function deltaLabel(delta: number, suffix: string, noChangeLabel: string): string {
  if (delta === 0) return noChangeLabel
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${suffix}`
}
