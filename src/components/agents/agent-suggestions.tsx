'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, GraduationCap, Loader2, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCan } from '@/hooks/use-can'

interface Suggestion {
  id: string
  kind: 'lesson'
  status: 'pending' | 'applied' | 'dismissed'
  title: string
  content: string
  evidence: { handoff_summary?: string } | null
  created_at: string
  applied_at: string | null
  dismissed_at: string | null
}

const STATUS_BADGE: Record<Suggestion['status'], { label: string; variant: 'secondary' | 'outline' }> = {
  pending: { label: 'Por rever', variant: 'outline' },
  applied: { label: 'Aplicada', variant: 'secondary' },
  dismissed: { label: 'Rejeitada', variant: 'outline' },
}

export function AgentSuggestions() {
  const canEdit = useCan('edit-settings')
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [acting, setActing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/ai/flywheel', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível carregar as sugestões.')
      setSuggestions(data.suggestions ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar as sugestões.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const runNow = async () => {
    setRunning(true)
    try {
      const response = await fetch('/api/ai/flywheel', { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível procurar novas lições.')
      toast.success(
        data.created > 0
          ? `${data.created} nova(s) lição(ões) por rever.`
          : 'Nenhuma lição nova encontrada — sem pedidos de ajuda recentes por analisar.',
      )
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível procurar novas lições.')
    } finally {
      setRunning(false)
    }
  }

  const act = async (id: string, action: 'apply' | 'dismiss') => {
    setActing(id)
    try {
      const response = await fetch(`/api/ai/flywheel/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível actualizar a sugestão.')
      toast.success(action === 'apply' ? 'Lição aplicada ao agente.' : 'Sugestão rejeitada.')
      setSuggestions((current) =>
        current?.map((item) =>
          item.id === id
            ? {
                ...item,
                status: action === 'apply' ? 'applied' : 'dismissed',
                applied_at: action === 'apply' ? new Date().toISOString() : null,
                dismissed_at: action === 'dismiss' ? new Date().toISOString() : null,
              }
            : item,
        ) ?? null,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível actualizar a sugestão.')
    } finally {
      setActing(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const pending = (suggestions ?? []).filter((item) => item.status === 'pending')
  const decided = (suggestions ?? []).filter((item) => item.status !== 'pending')

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Lições do agente</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Sempre que o agente pede ajuda humana, isto analisa o motivo e propõe uma regra concreta para lidar melhor da próxima vez. Nada é aplicado sem a sua aprovação.
          </p>
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => void runNow()} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Procurar agora
          </Button>
        )}
      </div>

      {pending.length === 0 && decided.length === 0 && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Ainda sem sugestões. Aparecem aqui sempre que o agente encaminhar uma conversa para um humano.
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-3">
          {pending.map((item) => (
            <Card key={item.id}>
              <CardHeader className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_BADGE[item.status].variant}>
                    {STATUS_BADGE[item.status].label}
                  </Badge>
                </div>
                <CardTitle className="text-base font-medium leading-snug">
                  {item.content}
                </CardTitle>
                {item.evidence?.handoff_summary && (
                  <CardDescription className="mt-1">
                    Motivo do pedido de ajuda: {item.evidence.handoff_summary}
                  </CardDescription>
                )}
              </CardHeader>
              {canEdit && (
                <CardContent className="flex gap-2 pt-0">
                  <Button
                    size="sm"
                    onClick={() => void act(item.id, 'apply')}
                    disabled={acting === item.id}
                  >
                    <Check className="h-4 w-4" /> Aplicar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void act(item.id, 'dismiss')}
                    disabled={acting === item.id}
                  >
                    <X className="h-4 w-4" /> Rejeitar
                  </Button>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Histórico
          </p>
          <div className="space-y-2">
            {decided.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm"
              >
                <p className="text-foreground">{item.content}</p>
                <Badge variant={STATUS_BADGE[item.status].variant} className="shrink-0">
                  {STATUS_BADGE[item.status].label}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
