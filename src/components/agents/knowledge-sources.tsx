'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Database, Loader2, MapPin, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useCan } from '@/hooks/use-can'

interface SourceState {
  configured: boolean
  agent_id: string | null
  enabled: boolean
  configuration: { agentCode: string; countryCode: string }
  last_test_status: 'success' | 'failed' | null
  last_test_message: string | null
  last_tested_at: string | null
}

export function KnowledgeSources() {
  const canEdit = useCan('edit-settings')
  const [state, setState] = useState<SourceState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/ai/knowledge-sources/novyra', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível carregar a fonte.')
      setState(data as SourceState)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar a fonte.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (enabled: boolean) => {
    if (!state || saving) return
    setSaving(true)
    try {
      const response = await fetch('/api/ai/knowledge-sources/novyra', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível actualizar a fonte.')
      setState((current) => (current ? { ...current, enabled: data.enabled } : current))
      toast.success(enabled ? 'NOVURA ligada a este agente.' : 'NOVURA desligada deste agente.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível actualizar a fonte.')
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    if (!state || testing) return
    setTesting(true)
    try {
      const response = await fetch('/api/ai/knowledge-sources/novyra/test', { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      setState((current) =>
        current
          ? {
              ...current,
              last_test_status: data.status ?? 'failed',
              last_test_message: data.message ?? data.error ?? 'Falha na ligação.',
              last_tested_at: data.tested_at ?? new Date().toISOString(),
            }
          : current,
      )
      if (!response.ok) throw new Error(data.message ?? data.error ?? 'Falha na ligação.')
      toast.success(data.message ?? 'Ligação válida.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha na ligação.')
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  }
  if (!state) return null

  const activationBlocked = !canEdit || !state.configured || !state.agent_id || saving
  const statusLabel = !state.configured ? 'Configuração incompleta' : state.enabled ? 'Ligada' : 'Desligada'

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Fontes de conhecimento</h2>
        <p className="mt-1 text-sm text-muted-foreground">Escolha, por agente, as fontes externas que podem acrescentar informação ao contexto da IA.</p>
      </div>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Database className="h-5 w-5" /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2"><CardTitle>NOVURA</CardTitle><Badge variant={state.enabled && state.configured ? 'default' : 'secondary'}>{statusLabel}</Badge></div>
              <CardDescription className="mt-2 max-w-xl">Base de conhecimento de notícias e informação verificada sobre Moçambique.</CardDescription>
            </div>
          </div>
          <Switch checked={state.enabled} disabled={activationBlocked} onCheckedChange={toggle} aria-label="Activar ou desactivar a NOVURA para este agente" />
        </CardHeader>

        <CardContent className="space-y-5">
          {!state.configured && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">Configuração do servidor incompleta. Confirme as variáveis NOVYRA no servidor antes de activar esta fonte.</div>}
          {!state.agent_id && <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Configure e guarde primeiro o agente de IA.</div>}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3"><div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> País</div><p className="mt-2 text-sm font-medium text-foreground">Moçambique</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Código do agente</p><code className="mt-2 block break-all text-sm text-foreground">{state.configuration.agentCode}</code></div>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                {state.last_test_status === 'success' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : state.last_test_status === 'failed' ? <XCircle className="h-4 w-4 text-destructive" /> : null}
                Último teste
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {state.last_tested_at ? new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.last_tested_at)) : 'Ainda não realizado'}
                {state.last_test_message ? ` — ${state.last_test_message}` : ''}
              </p>
            </div>
            <Button type="button" variant="outline" disabled={!canEdit || !state.configured || !state.agent_id || testing} onClick={testConnection}>
              {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Testar ligação
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
