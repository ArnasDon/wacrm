"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { useLocale } from 'next-intl'
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  Check,
  CheckCheck,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Layers,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserPlus,
  Wrench,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'

import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { getDateFnsLocale } from '@/lib/date-fns-locale'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Notification } from '@/types'
import type { SentinelaStatusResponse } from '@/app/api/sentinela/status/route'

type PromptScenario = 'live_anomalies' | 'whatsapp_webhook' | 'ai_clara' | 'campaigns_cron'

export default function SentinelaPage() {
  const router = useRouter()
  const appLocale = useLocale()
  const dateFnsLocale = getDateFnsLocale(appLocale)
  const { accountId } = useAuth()

  // Sentinela live status state
  const [statusData, setStatusData] = useState<SentinelaStatusResponse | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [fixingAuto, setFixingAuto] = useState(false)

  // Antigravity Prompt Generator state
  const [scenario, setScenario] = useState<PromptScenario>('live_anomalies')
  const [customNote, setCustomNote] = useState('')
  const [copiedPrompt, setCopiedPrompt] = useState(false)

  // CRM Notifications state
  const [notifications, setNotifications] = useState<Notification[] | null>(null)
  const [notifFilter, setNotifFilter] = useState<'all' | 'unread'>('all')
  const [markingAll, setMarkingAll] = useState(false)

  const loadSentinelaStatus = useCallback(async (silent = false) => {
    if (!silent) setStatusLoading(true)
    try {
      const res = await fetch('/api/sentinela/status', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as SentinelaStatusResponse
      setStatusData(json)
    } catch (err) {
      console.error('[sentinela] status load error:', err)
      if (!silent) {
        toast.error('Não foi possível carregar o diagnóstico do Sentinela.')
      }
    } finally {
      setStatusLoading(false)
    }
  }, [])

  const loadNotifications = useCallback(async () => {
    if (!accountId) return
    const supabase = createClient()
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(100)
    setNotifications((data ?? []) as Notification[])
  }, [accountId])

  useEffect(() => {
    void loadSentinelaStatus()
    void loadNotifications()
  }, [loadSentinelaStatus, loadNotifications])

  // Realtime subscription for CRM notifications
  useEffect(() => {
    if (!accountId) return
    const supabase = createClient()
    const channel = supabase
      .channel('sentinela-notifications-feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Notification
            setNotifications((prev) => {
              if (!prev) return [row]
              if (prev.some((n) => n.id === row.id)) return prev
              return [row, ...prev]
            })
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as Notification
            setNotifications(
              (prev) => prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ?? prev,
            )
          } else if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as Partial<Notification>
            setNotifications((prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev)
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [accountId])

  const handleAutoFix = useCallback(async () => {
    setFixingAuto(true)
    try {
      const res = await fetch('/api/sentinela/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fix_auto' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const rem = data.remediation || {}
      toast.success(
        `Auto-cura executada! Lotes: ${rem.envioLotesResumed ?? 0} | IA/Clara: ${rem.aiConversationsRecovered ?? 0} | Filas: ${(rem.scheduledSendsRescheduled ?? 0) + (rem.automationsRescheduled ?? 0)}`,
      )
      await loadSentinelaStatus(true)
    } catch (err) {
      console.error('[sentinela] fix_auto failed:', err)
      toast.error('Falha ao executar a correção automática.')
    } finally {
      setFixingAuto(false)
    }
  }, [loadSentinelaStatus])

  const markNotificationRead = useCallback(
    async (id: string) => {
      const now = new Date().toISOString()
      setNotifications(
        (prev) => prev?.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)) ?? prev,
      )
      const supabase = createClient()
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: now })
        .eq('id', id)
        .is('read_at', null)
      if (error) {
        toast.error('Falha ao marcar notificação como lida.')
        void loadNotifications()
      }
    },
    [loadNotifications],
  )

  const markAllNotificationsRead = useCallback(async () => {
    const unreadIds = notifications?.filter((n) => !n.read_at).map((n) => n.id) ?? []
    if (unreadIds.length === 0) return
    setMarkingAll(true)
    const now = new Date().toISOString()
    setNotifications((prev) => prev?.map((n) => (n.read_at ? n : { ...n, read_at: now })) ?? prev)
    const supabase = createClient()
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: now })
      .is('read_at', null)
    setMarkingAll(false)
    if (error) {
      toast.error('Falha ao marcar todas como lidas.')
      void loadNotifications()
    } else {
      toast.success('Todas as notificações foram marcadas como lidas.')
    }
  }, [notifications, loadNotifications])

  // Build the ready-to-paste Antigravity prompt
  const generatedPrompt = useMemo(() => {
    const timestamp = statusData?.checkedAt
      ? new Date(statusData.checkedAt).toLocaleString('pt-BR')
      : new Date().toLocaleString('pt-BR')

    const lines: string[] = [
      `Atue como Engenheiro Sênior do WACRM (C:\\Projetos\\WACRM) com acesso ao Supabase de produção (advgpexabtbvkvpqxqjl).`,
      `O Sentinela do CRM gerou este diagnóstico em ${timestamp}.`,
      ``,
    ]

    if (customNote.trim()) {
      lines.push(`### Observação do Administrador (Ronaldo Meira):`)
      lines.push(`"${customNote.trim()}"`)
      lines.push(``)
    }

    if (scenario === 'live_anomalies') {
      const total = statusData?.totalAnomalies ?? 0
      lines.push(`### Diagnóstico em Tempo Real do Sentinela (${total} anomalia(s)):`)
      if (statusData) {
        lines.push(
          `- Filas Travadas: ${statusData.breakdown.queues.total} (scheduled_sends: ${statusData.breakdown.queues.scheduledSendsStuck}, automations: ${statusData.breakdown.queues.automationsStuck}, envio_lotes pausados: ${statusData.breakdown.queues.envioLotesPaused})`,
        )
        lines.push(
          `- IA Clara Travada: ${statusData.breakdown.aiClara.total} (pending_human > 10m: ${statusData.breakdown.aiClara.pendingHumanTimeout}, limite >= 8 sem corretor: ${statusData.breakdown.aiClara.replyLimitUnassigned})`,
        )
        lines.push(
          `- Deals Fantasmas (contact_id IS NULL): ${statusData.breakdown.ghosts.dealsWithoutContact}`,
        )

        if (statusData.details.pausedLotes.length > 0) {
          lines.push(``)
          lines.push(`#### Lotes Pausados:`)
          for (const l of statusData.details.pausedLotes) {
            lines.push(
              `- Lote #${l.numeroLote} (${l.envioTitulo}) | lote_id: ${l.id} | envio_id: ${l.envioId} | leads: ${l.quantidadeLeads}`,
            )
          }
        }

        if (statusData.details.stuckConversations.length > 0) {
          lines.push(``)
          lines.push(`#### Conversas da IA Clara Travadas:`)
          for (const c of statusData.details.stuckConversations) {
            lines.push(
              `- Lead: ${c.contactName} (${c.contactPhone}) | conversation_id: ${c.id} | motivo: ${c.reason} | ai_reply_count: ${c.aiReplyCount}`,
            )
          }
        }

        if (statusData.details.scheduledSends.length > 0) {
          lines.push(``)
          lines.push(`#### Envios Agendados Atrasados (>15m):`)
          for (const s of statusData.details.scheduledSends) {
            lines.push(
              `- Contato: ${s.contactName} | template: ${s.templateName} | atraso: ${s.delayMinutes}min | id: ${s.id}`,
            )
          }
        }

        if (statusData.details.automations.length > 0) {
          lines.push(``)
          lines.push(`#### Automações Atrasadas (>10m):`)
          for (const a of statusData.details.automations) {
            lines.push(
              `- Automação: ${a.automationName} | Lead: ${a.contactName} | atraso: ${a.delayMinutes}min | id: ${a.id}`,
            )
          }
        }

        if (statusData.details.ghostDeals.length > 0) {
          lines.push(``)
          lines.push(`#### Deals Fantasmas (sem contact_id):`)
          for (const d of statusData.details.ghostDeals) {
            lines.push(`- Título: "${d.title}" | deal_id: ${d.id} | criado em: ${d.createdAt}`)
          }
        }

        if (statusData.queryErrors.length > 0) {
          lines.push(``)
          lines.push(`#### Erros de Query/Banco:`)
          for (const err of statusData.queryErrors) {
            lines.push(`- ${err}`)
          }
        }
      }
      lines.push(``)
      lines.push(`### Arquivos-Alvo Relevantes:`)
      lines.push(`- src/app/api/sentinela/cron/route.ts`)
      lines.push(`- src/app/api/sentinela/actions/route.ts`)
      lines.push(`- src/lib/ai/agent-responder.ts`)
      lines.push(`- src/app/api/campaigns/envios/cron/route.ts`)
      lines.push(`- src/app/api/automations/cron/route.ts`)
    } else if (scenario === 'whatsapp_webhook') {
      lines.push(`### Escopo: Auditoria e Correção no Webhook do WhatsApp`)
      lines.push(`- Inspecione src/app/api/whatsapp/webhook/route.ts e src/app/api/whatsapp/send/route.ts`)
      lines.push(`- Verifique no Supabase (mensagens e webhook_deliveries recentes) se houve falha de recebimento, mídia ou entrega da Meta Cloud API.`)
    } else if (scenario === 'ai_clara') {
      lines.push(`### Escopo: Auditoria e Correção na IA Clara (Atendimento & Handoff)`)
      lines.push(`- Inspecione src/lib/ai/agent-responder.ts e src/lib/ai/lead-analysis.ts`)
      lines.push(`- Verifique conversas recentes onde a Clara não respondeu, atingiu ai_reply_count >= 8 ou ficou presa em pending_human.`)
    } else if (scenario === 'campaigns_cron') {
      lines.push(`### Escopo: Auditoria e Correção nos Disparos em Lote e Filas Agendadas`)
      lines.push(`- Inspecione src/app/api/campaigns/envios/cron/route.ts, src/lib/campaigns/envios-runner.ts e src/app/api/scheduled-sends/cron/route.ts`)
      lines.push(`- Verifique o status das tabelas envios, envio_lotes, envio_leads e scheduled_sends no Supabase.`)
    }

    lines.push(``)
    lines.push(`### Plano de Execução Solicitado no Antigravity:`)
    lines.push(`1. Analise a causa raiz no código e nos registros do Supabase de produção.`)
    lines.push(`2. Aplique a correção cirúrgica no código e/ou execute o ajuste necessário via API do Supabase.`)
    lines.push(`3. Valide a tipagem com \`npx tsc --noEmit\`.`)
    lines.push(`4. Faça \`git add\`, \`git commit\` e \`git push origin main\` para publicar o deploy automaticamente na Hostinger.`)

    return lines.join('\n')
  }, [statusData, scenario, customNote])

  const handleCopyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(generatedPrompt)
      setCopiedPrompt(true)
      toast.success('Prompt copiado! Basta colar no chat do Antigravity.')
      setTimeout(() => setCopiedPrompt(false), 2500)
    } catch {
      toast.error('Não foi possível copiar automaticamente.')
    }
  }, [generatedPrompt])

  const unreadNotificationsCount = useMemo(
    () => notifications?.filter((n) => !n.read_at).length ?? 0,
    [notifications],
  )

  const filteredNotifications = useMemo(() => {
    if (!notifications) return null
    if (notifFilter === 'unread') return notifications.filter((n) => !n.read_at)
    return notifications
  }, [notifications, notifFilter])

  const totalAnomalies = statusData?.totalAnomalies ?? 0

  return (
    <div className="space-y-6 pb-10">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-xl border',
                totalAnomalies > 0
                  ? 'border-red-500/40 bg-red-500/10 text-red-400'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
              )}
            >
              {totalAnomalies > 0 ? (
                <ShieldAlert className="h-5 w-5" />
              ) : (
                <ShieldCheck className="h-5 w-5" />
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Sentinela & Notificações</h1>
              <p className="text-xs text-muted-foreground">
                Monitoramento ativo de filas, IA Clara, integridade do banco e central de alertas do CRM.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadSentinelaStatus(false)}
            disabled={statusLoading}
          >
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', statusLoading && 'animate-spin')} />
            Verificar Agora
          </Button>

          <Button
            size="sm"
            onClick={() => void handleAutoFix()}
            disabled={fixingAuto || statusLoading}
            className={cn(
              totalAnomalies > 0
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-primary text-primary-foreground',
            )}
          >
            {fixingAuto ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="mr-1.5 h-3.5 w-3.5" />
            )}
            {totalAnomalies > 0
              ? `Auto-Corrigir (${totalAnomalies})`
              : 'Reprocessar Filas e IA'}
          </Button>
        </div>
      </div>

      {/* Status Banner */}
      <div
        className={cn(
          'flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between',
          totalAnomalies > 0
            ? 'border-red-500/40 bg-red-500/10'
            : 'border-emerald-500/30 bg-emerald-500/5',
        )}
      >
        <div className="flex items-start gap-3">
          {statusLoading ? (
            <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
          ) : totalAnomalies > 0 ? (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          )}
          <div>
            <p className="text-sm font-semibold text-foreground">
              {statusLoading
                ? 'Executando varredura no Supabase...'
                : totalAnomalies > 0
                  ? `🚨 ${totalAnomalies} anomalia(s) detectada(s) aguardando ação`
                  : 'Sistema 100% Saudável — Nenhuma fila ou conversa travada'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {statusData?.checkedAt
                ? `Última verificação: ${new Date(statusData.checkedAt).toLocaleTimeString('pt-BR')} • Cron ativo na Hostinger (a cada hora)`
                : 'Verificando integridade operacional...'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-foreground">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Push Exclusivo: Ronaldo Meira
          </span>
        </div>
      </div>

      {/* 3 Pillars of Sentinela */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Card 1: Queues & Broadcasts */}
        <div className="flex flex-col rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                <Layers className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Filas & Disparos</h2>
                <p className="text-[11px] text-muted-foreground">
                  Envios agendados, automações e lotes
                </p>
              </div>
            </div>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-bold',
                (statusData?.breakdown.queues.total ?? 0) > 0
                  ? 'bg-red-500/15 text-red-400'
                  : 'bg-emerald-500/15 text-emerald-400',
              )}
            >
              {statusData?.breakdown.queues.total ?? 0}
            </span>
          </div>

          <div className="mt-4 flex-1 space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Envios agendados (&gt;15m)</span>
              <span className="font-semibold text-foreground">
                {statusData?.breakdown.queues.scheduledSendsStuck ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Automações pendentes (&gt;10m)</span>
              <span className="font-semibold text-foreground">
                {statusData?.breakdown.queues.automationsStuck ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Lotes de campanha pausados</span>
              <span className="font-semibold text-foreground">
                {statusData?.breakdown.queues.envioLotesPaused ?? 0}
              </span>
            </div>

            {statusData && statusData.details.pausedLotes.length > 0 && (
              <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                {statusData.details.pausedLotes.map((lote) => (
                  <div
                    key={lote.id}
                    className="flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5"
                  >
                    <span className="truncate font-medium text-foreground">
                      Lote #{lote.numeroLote} — {lote.envioTitulo}
                    </span>
                    <Link
                      href={`/campaigns/envios/${lote.envioId}`}
                      className="ml-2 shrink-0 text-[11px] text-primary hover:underline"
                    >
                      Abrir
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Card 2: AI Clara */}
        <div className="flex flex-col rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">IA Clara & Handoff</h2>
                <p className="text-[11px] text-muted-foreground">
                  Transbordo humano e limite de segurança
                </p>
              </div>
            </div>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-bold',
                (statusData?.breakdown.aiClara.total ?? 0) > 0
                  ? 'bg-red-500/15 text-red-400'
                  : 'bg-emerald-500/15 text-emerald-400',
              )}
            >
              {statusData?.breakdown.aiClara.total ?? 0}
            </span>
          </div>

          <div className="mt-4 flex-1 space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Aguardando humano (&gt;10m)</span>
              <span className="font-semibold text-foreground">
                {statusData?.breakdown.aiClara.pendingHumanTimeout ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Limite 8 respostas sem corretor</span>
              <span className="font-semibold text-foreground">
                {statusData?.breakdown.aiClara.replyLimitUnassigned ?? 0}
              </span>
            </div>

            {statusData && statusData.details.stuckConversations.length > 0 && (
              <div className="mt-2 max-h-36 space-y-1.5 overflow-y-auto border-t border-border pt-2">
                {statusData.details.stuckConversations.map((conv) => (
                  <div
                    key={conv.id}
                    className="flex items-center justify-between rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-1.5"
                  >
                    <span className="truncate font-medium text-foreground">
                      {conv.contactName} ({conv.aiReplyCount} resp.)
                    </span>
                    <Link
                      href={`/inbox?c=${conv.id}`}
                      className="ml-2 inline-flex shrink-0 items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      Inbox <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Card 3: Database Integrity & Ghosts */}
        <div className="flex flex-col rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                <Database className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Integridade do Banco</h2>
                <p className="text-[11px] text-muted-foreground">
                  Deals órfãos e saúde das tabelas
                </p>
              </div>
            </div>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-bold',
                (statusData?.breakdown.ghosts.total ?? 0) > 0
                  ? 'bg-red-500/15 text-red-400'
                  : 'bg-emerald-500/15 text-emerald-400',
              )}
            >
              {statusData?.breakdown.ghosts.total ?? 0}
            </span>
          </div>

          <div className="mt-4 flex-1 space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Deals fantasmas (sem contato)</span>
              <span className="font-semibold text-foreground">
                {statusData?.breakdown.ghosts.dealsWithoutContact ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Erros de consulta SQL</span>
              <span className="font-semibold text-foreground">
                {statusData?.queryErrors.length ?? 0}
              </span>
            </div>

            {statusData && statusData.details.ghostDeals.length > 0 && (
              <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                {statusData.details.ghostDeals.map((deal) => (
                  <div
                    key={deal.id}
                    className="flex items-center justify-between rounded-md border border-purple-500/30 bg-purple-500/5 px-2.5 py-1.5"
                  >
                    <span className="truncate font-medium text-foreground">{deal.title}</span>
                    <span className="text-[10px] text-muted-foreground">Sem contato</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Antigravity Bridge: Prompt Generator for Code Fix + Commit + Deploy */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">
                Ponte Antigravity — Correção de Código, Commit & Deploy
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Problemas de fila/IA no banco são resolvidos direto pelo botão{' '}
              <strong className="text-foreground">Reprocessar Filas e IA</strong> acima. Quando uma falha
              exigir alteração de código-fonte, commit e deploy na Hostinger, copie o prompt técnico
              gerado abaixo (já preenchido com os IDs e arquivos reais) e cole no Antigravity.
            </p>
          </div>

          <Button size="sm" onClick={() => void handleCopyPrompt()} className="shrink-0">
            {copiedPrompt ? (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                Prompt Copiado!
              </>
            ) : (
              <>
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copiar Prompt para Antigravity
              </>
            )}
          </Button>
        </div>

        {/* Scenario Selector Pills */}
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            {
              id: 'live_anomalies' as const,
              label: `Diagnóstico Atual (${totalAnomalies})`,
              icon: Activity,
            },
            {
              id: 'whatsapp_webhook' as const,
              label: 'Webhook / Mensagens WhatsApp',
              icon: Wrench,
            },
            {
              id: 'ai_clara' as const,
              label: 'IA Clara / Transbordo',
              icon: Bot,
            },
            {
              id: 'campaigns_cron' as const,
              label: 'Campanhas / Lotes / Crons',
              icon: Sparkles,
            },
          ].map((item) => {
            const Icon = item.icon
            const active = scenario === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setScenario(item.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            )
          })}
        </div>

        {/* Optional Note Input */}
        <div className="mt-3">
          <input
            type="text"
            value={customNote}
            onChange={(e) => setCustomNote(e.target.value)}
            placeholder="Opcional: descreva o que você notou (ex.: 'O lead João enviou mensagem às 14h e a Clara não respondeu')..."
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>

        {/* Generated Prompt Preview */}
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">
            {generatedPrompt}
          </pre>
        </div>
      </div>

      {/* Unified CRM Notifications Feed */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold text-foreground">
              Central de Notificações do CRM
            </h2>
            {unreadNotificationsCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                {unreadNotificationsCount}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
              <button
                type="button"
                onClick={() => setNotifFilter('all')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  notifFilter === 'all'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Todas ({notifications?.length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setNotifFilter('unread')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  notifFilter === 'unread'
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Não lidas ({unreadNotificationsCount})
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              disabled={unreadNotificationsCount === 0 || markingAll}
              onClick={() => void markAllNotificationsRead()}
            >
              {markingAll ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
              )}
              Marcar tudo como lido
            </Button>
          </div>
        </div>

        <div className="mt-4">
          {filteredNotifications === null ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex h-28 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-center">
              <Bell className="mb-1.5 h-5 w-5 text-muted-foreground/60" />
              <p className="text-xs font-medium text-muted-foreground">
                {notifFilter === 'unread'
                  ? 'Nenhuma notificação não lida no momento.'
                  : 'Nenhuma notificação registrada ainda.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filteredNotifications.map((n) => {
                const isUnread = !n.read_at
                return (
                  <li key={n.id} className="py-2.5 first:pt-0 last:pb-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (isUnread) void markNotificationRead(n.id)
                        if (n.conversation_id) router.push(`/inbox?c=${n.conversation_id}`)
                      }}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-colors',
                        isUnread ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/60',
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          isUnread ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                        )}
                      >
                        <UserPlus className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={cn(
                              'truncate text-sm',
                              isUnread
                                ? 'font-semibold text-foreground'
                                : 'font-medium text-muted-foreground',
                            )}
                          >
                            {n.title}
                          </p>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {formatDistanceToNow(new Date(n.created_at), {
                              addSuffix: true,
                              locale: dateFnsLocale,
                            })}
                          </span>
                        </div>
                        {n.body && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{n.body}</p>
                        )}
                      </div>
                      {isUnread && (
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
