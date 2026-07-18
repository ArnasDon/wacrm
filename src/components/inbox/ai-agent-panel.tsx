"use client"

import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, Pause, Play, UserRound } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCan } from '@/hooks/use-can'

type EffectiveStatus = 'active' | 'paused' | 'handoff' | 'disabled'
type Decision = { action?: string; text?: string; reason?: string }
type StatusResponse = {
  agent: { id: string; enabled: boolean; name: string } | null
  effective_status: EffectiveStatus
  last_run: { id: string; status: string; decision: Decision | null; error_message: string | null; created_at: string; finished_at: string | null } | null
}

type MessageParams = Record<string, string | number | null | undefined>

const COPY: Record<string, string> = {
  'inbox.aiAgent': 'AI agent',
  'inbox.aiAgent.active': 'Active',
  'inbox.aiAgent.paused': 'Paused',
  'inbox.aiAgent.handoff': 'Handoff',
  'inbox.aiAgent.disabled': 'Disabled',
  'inbox.aiAgent.loadFailed': 'Failed to load AI agent status',
  'inbox.aiAgent.updateFailed': 'Failed to update AI agent status',
  'inbox.aiAgent.loadingStatus': 'Loading AI status...',
  'inbox.aiAgent.noEnabledAgent': 'No enabled inbox agent for this workspace.',
  'inbox.aiAgent.lastRun': 'Last run: {status}',
  'inbox.aiAgent.noRunsYet': 'no runs yet',
  'inbox.aiAgent.pause': 'Pause',
  'inbox.aiAgent.resume': 'Resume',
  'inbox.aiAgent.handoffAction': 'Handoff',
  'inbox.aiAgent.decision.failed': 'Last run failed',
  'inbox.aiAgent.decision.failedWithMessage': 'Last run failed: {message}',
  'inbox.aiAgent.decision.reply': 'Replied: {text}',
  'inbox.aiAgent.decision.noReply': 'No reply: {reason}',
  'inbox.aiAgent.decision.handoff': 'Handed off: {reason}',
}

function t(key: string, params: MessageParams = {}): string {
  const template = COPY[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name]
    return value === null || value === undefined ? '' : String(value)
  })
}

export function formatAiDecisionSummary(run: StatusResponse['last_run'], t: (key: string, params?: Record<string, string>) => string): string | null {
  if (!run) return null
  if (run.status === 'failed') return run.error_message ? t('inbox.aiAgent.decision.failedWithMessage', { message: run.error_message.slice(0, 120) }) : t('inbox.aiAgent.decision.failed')
  const decision = run.decision
  if (!decision) return null
  if (decision.action === 'reply' && decision.text) return t('inbox.aiAgent.decision.reply', { text: decision.text.slice(0, 80) })
  if (decision.action === 'no_reply' && decision.reason) return t('inbox.aiAgent.decision.noReply', { reason: decision.reason.slice(0, 80) })
  if (decision.action === 'handoff' && decision.reason) return t('inbox.aiAgent.decision.handoff', { reason: decision.reason.slice(0, 80) })
  return null
}

export function AiAgentPanel({ conversationId, refreshToken }: { conversationId: string | null; refreshToken?: string | number }) {
  const canSend = useCan('send-messages')
  const [data, setData] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null)
  const currentConversationIdRef = useRef(conversationId)
  currentConversationIdRef.current = conversationId

  useEffect(() => {
    const controller = new AbortController()
    const requestedConversationId = conversationId
    let active = true

    setData(null)
    setError(null)
    setLoadedConversationId(null)
    setSaving(false)
    if (!conversationId) {
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const response = await fetch(`/api/ai-agent/conversation/${conversationId}`, { signal: controller.signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? t('inbox.aiAgent.loadFailed'))
        if (active) {
          setData(body)
          setLoadedConversationId(requestedConversationId)
        }
      } catch (cause) {
        if (active && !(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError(cause instanceof Error ? cause.message : t('inbox.aiAgent.loadFailed'))
        }
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
      controller.abort()
    }
  }, [conversationId, refreshToken])

  const update = async (action: 'pause' | 'resume' | 'handoff') => {
    if (!conversationId || loadedConversationId !== conversationId) return
    const requestedConversationId = conversationId
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/ai-agent/conversation/${conversationId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? t('inbox.aiAgent.updateFailed'))
      if (currentConversationIdRef.current === requestedConversationId) setData(body)
    } catch (cause) {
      if (currentConversationIdRef.current === requestedConversationId) {
        setError(cause instanceof Error ? cause.message : t('inbox.aiAgent.updateFailed'))
      }
    } finally {
      if (currentConversationIdRef.current === requestedConversationId) setSaving(false)
    }
  }

  if (!conversationId) return null
  const isStatusLoaded = loadedConversationId === conversationId
  const status = isStatusLoaded ? data?.effective_status : undefined
  const disabled = loading || saving || !isStatusLoaded
  const summary = formatAiDecisionSummary(data?.last_run ?? null, t)

  return <section className="mt-4 border-t border-border pt-4" aria-label={t('inbox.aiAgent')}>
    <div className="flex items-center justify-between gap-2 px-1">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"><Bot className="h-3 w-3" />{t('inbox.aiAgent')}</div>
      {status && <Badge variant={status === 'disabled' ? 'outline' : status === 'handoff' ? 'secondary' : status === 'paused' ? 'outline' : 'default'}>{t(`inbox.aiAgent.${status}`)}</Badge>}
    </div>
    {loading ? <div className="mt-2 flex items-center gap-2 px-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{t('inbox.aiAgent.loadingStatus')}</div> : status === 'disabled' ? <p className="mt-2 px-1 text-xs text-muted-foreground">{t('inbox.aiAgent.noEnabledAgent')}</p> : <>
      <div className="mt-2 space-y-1 px-1 text-xs text-muted-foreground">
        <p>{t('inbox.aiAgent.lastRun', { status: data?.last_run?.status ?? t('inbox.aiAgent.noRunsYet') })}</p>
        {summary && <p className="line-clamp-2">{summary}</p>}
      </div>
      {canSend && <div className="mt-3 flex flex-wrap gap-1.5">
        {status === 'active' && <Button size="xs" variant="outline" disabled={disabled} onClick={() => void update('pause')}><Pause />{t('inbox.aiAgent.pause')}</Button>}
        {(status === 'paused' || status === 'handoff') && <Button size="xs" variant="outline" disabled={disabled} onClick={() => void update('resume')}><Play />{t('inbox.aiAgent.resume')}</Button>}
        {status !== 'handoff' && <Button size="xs" variant="secondary" disabled={disabled} onClick={() => void update('handoff')}><UserRound />{t('inbox.aiAgent.handoffAction')}</Button>}
      </div>}
    </>}
    {error && <p className="mt-2 px-1 text-xs text-destructive">{error}</p>}
  </section>
}
