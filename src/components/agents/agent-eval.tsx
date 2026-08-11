'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FlaskConical, Loader2, PlayCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useCan } from '@/hooks/use-can'

interface CaseMeta {
  id: string
  description: string
  withTools: boolean
}

interface PersonaMeta {
  id: string
  description: string
  goal: string
}

interface CriterionResult {
  criterion: string
  score: number
  reason: string
}

interface ToolCallRecord {
  name: string
  arguments: Record<string, unknown>
}

interface CaseRunResult {
  id: string
  description: string
  response: string
  handoff: boolean
  criteria: CriterionResult[]
  score: number
  toolCalls: ToolCallRecord[]
}

interface PersonaRunResult {
  transcript: Array<{ role: string; content: unknown }>
  issues: string[]
  completedGoal: boolean
  handoff: boolean
  toolCalls: ToolCallRecord[]
}

type RunStatus = 'idle' | 'running' | 'done' | 'error'

function scoreBadge(score: number) {
  if (score >= 0.8) return { label: score.toFixed(2), variant: 'secondary' as const }
  if (score >= 0.5) return { label: score.toFixed(2), variant: 'outline' as const }
  return { label: score.toFixed(2), variant: 'destructive' as const }
}

function ToolCallList({ calls }: { calls: ToolCallRecord[] }) {
  if (calls.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhuma ferramenta chamada.</p>
  }
  return (
    <ul className="space-y-1">
      {calls.map((call, index) => (
        <li key={index} className="rounded-md border border-border/60 px-2 py-1 text-xs">
          <span className="font-medium text-foreground">{call.name}</span>{' '}
          <span className="text-muted-foreground">{JSON.stringify(call.arguments)}</span>
        </li>
      ))}
    </ul>
  )
}

export function AgentEval() {
  const canRun = useCan('edit-settings')
  const [cases, setCases] = useState<CaseMeta[] | null>(null)
  const [personas, setPersonas] = useState<PersonaMeta[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [caseStatus, setCaseStatus] = useState<Record<string, RunStatus>>({})
  const [caseResults, setCaseResults] = useState<Record<string, CaseRunResult>>({})
  const [personaStatus, setPersonaStatus] = useState<Record<string, RunStatus>>({})
  const [personaResults, setPersonaResults] = useState<Record<string, PersonaRunResult>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [runningAll, setRunningAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/ai/eval/cases', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível carregar os testes.')
      setCases(data.cases ?? [])
      setPersonas(data.personas ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar os testes.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const runOne = useCallback(async (kind: 'case' | 'persona', id: string) => {
    const setStatus = kind === 'case' ? setCaseStatus : setPersonaStatus
    setStatus((current) => ({ ...current, [id]: 'running' }))
    try {
      const response = await fetch('/api/ai/eval/run-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Falha ao correr o teste.')
      if (kind === 'case') setCaseResults((current) => ({ ...current, [id]: data.result }))
      else setPersonaResults((current) => ({ ...current, [id]: data.result }))
      setStatus((current) => ({ ...current, [id]: 'done' }))
    } catch (error) {
      setStatus((current) => ({ ...current, [id]: 'error' }))
      toast.error(error instanceof Error ? error.message : 'Falha ao correr o teste.')
    }
  }, [])

  const runAllCases = async () => {
    if (!cases) return
    if (!confirm(`Vai correr ${cases.length} casos de teste, cada um com 2 chamadas reais ao teu modelo de IA. Continuar?`)) return
    setRunningAll(true)
    for (const c of cases) await runOne('case', c.id)
    setRunningAll(false)
  }

  const runAllPersonas = async () => {
    if (!personas) return
    if (!confirm(`Vai correr ${personas.length} simulações de cliente — mais lento e caro (várias trocas por simulação). Continuar?`)) return
    setRunningAll(true)
    for (const p of personas) await runOne('persona', p.id)
    setRunningAll(false)
  }

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Avaliação do agente</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Corre cada teste com a tua própria chave de IA já configurada — gasta tokens reais da tua conta.
          Máximo 3 corridas completas por hora.
        </p>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Casos de teste ({cases?.length ?? 0})</h3>
          {canRun && (
            <Button size="sm" variant="outline" onClick={() => void runAllCases()} disabled={runningAll}>
              {runningAll ? <Loader2 className="animate-spin" /> : <PlayCircle />} Correr todos
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {cases?.map((c) => {
            const status = caseStatus[c.id] ?? 'idle'
            const result = caseResults[c.id]
            const isOpen = expanded[c.id]
            return (
              <Card key={c.id}>
                <CardHeader
                  className="cursor-pointer flex-row items-center justify-between gap-2 space-y-0 py-3"
                  onClick={() => setExpanded((s) => ({ ...s, [c.id]: !s[c.id] }))}
                >
                  <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <div>
                      <CardTitle className="text-sm">{c.id}</CardTitle>
                      <CardDescription>{c.description}</CardDescription>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {result && <Badge variant={scoreBadge(result.score).variant}>{scoreBadge(result.score).label}</Badge>}
                    {status === 'running' && <Loader2 className="h-4 w-4 animate-spin" />}
                    {canRun && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={status === 'running'}
                        onClick={(e) => {
                          e.stopPropagation()
                          void runOne('case', c.id)
                        }}
                      >
                        Correr
                      </Button>
                    )}
                  </div>
                </CardHeader>
                {isOpen && result && (
                  <CardContent className="space-y-3 pt-0 text-sm">
                    <p className="rounded-md bg-muted/40 p-2 text-foreground">{result.response || '[handoff]'}</p>
                    <div className="space-y-1">
                      {result.criteria.map((crit, i) => (
                        <div key={i} className="flex items-start justify-between gap-3 text-xs">
                          <span className="text-muted-foreground">{crit.criterion} — {crit.reason}</span>
                          <Badge variant={scoreBadge(crit.score).variant} className="shrink-0">{crit.score.toFixed(2)}</Badge>
                        </div>
                      ))}
                    </div>
                    {c.withTools && (
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Ferramentas chamadas</p>
                        <ToolCallList calls={result.toolCalls} />
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Simulações de clientes ({personas?.length ?? 0})</h3>
          {canRun && (
            <Button size="sm" variant="outline" onClick={() => void runAllPersonas()} disabled={runningAll}>
              {runningAll ? <Loader2 className="animate-spin" /> : <PlayCircle />} Correr todas
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {personas?.map((p) => {
            const status = personaStatus[p.id] ?? 'idle'
            const result = personaResults[p.id]
            const isOpen = expanded[`persona:${p.id}`]
            return (
              <Card key={p.id}>
                <CardHeader
                  className="cursor-pointer flex-row items-center justify-between gap-2 space-y-0 py-3"
                  onClick={() => setExpanded((s) => ({ ...s, [`persona:${p.id}`]: !s[`persona:${p.id}`] }))}
                >
                  <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <div>
                      <CardTitle className="text-sm">{p.id}</CardTitle>
                      <CardDescription>{p.description}</CardDescription>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {result && (
                      <Badge variant={result.completedGoal ? 'secondary' : 'destructive'}>
                        {result.completedGoal ? 'Objectivo cumprido' : 'Falhou'}
                      </Badge>
                    )}
                    {status === 'running' && <Loader2 className="h-4 w-4 animate-spin" />}
                    {canRun && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={status === 'running'}
                        onClick={(e) => {
                          e.stopPropagation()
                          void runOne('persona', p.id)
                        }}
                      >
                        Correr
                      </Button>
                    )}
                  </div>
                </CardHeader>
                {isOpen && result && (
                  <CardContent className="space-y-3 pt-0 text-sm">
                    {result.issues.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Problemas encontrados</p>
                        <ul className="list-inside list-disc text-xs text-destructive">
                          {result.issues.map((issue, i) => <li key={i}>{issue}</li>)}
                        </ul>
                      </div>
                    )}
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Conversa simulada</p>
                      <div className="space-y-1.5">
                        {result.transcript.map((turn, i) => (
                          <p key={i} className="text-xs">
                            <span className="font-medium">{turn.role === 'user' ? 'Cliente' : 'Agente'}:</span>{' '}
                            <span className="text-muted-foreground">{typeof turn.content === 'string' ? turn.content : JSON.stringify(turn.content)}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Ferramentas chamadas</p>
                      <ToolCallList calls={result.toolCalls} />
                    </div>
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      </section>
    </div>
  )
}
