'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Bot,
  Boxes,
  BrainCircuit,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Image,
  Loader2,
  MessageCircleReply,
  Radio,
  RefreshCw,
  Sparkles,
  Tags,
  UserRoundCheck,
  Wrench,
  XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { autoLayout } from '@/lib/flows/layout'
import type { AgentToolKey } from '@/lib/ai/tool-permissions'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useAuth } from '@/hooks/use-auth'

/** A node/tool "pulses" as live when it saw activity within this window. */
const LIVE_WINDOW_MS = 5 * 60_000

const CALL_TIME_FORMATTER = new Intl.DateTimeFormat('pt-PT', {
  hour: '2-digit',
  minute: '2-digit',
})

type AgentTab = 'runtime' | 'tools' | 'usage'

interface ConfigResponse {
  configured: boolean
  provider?: 'openai' | 'anthropic'
  model?: string
  is_active?: boolean
  auto_reply_enabled?: boolean
  buffer_window_seconds?: number
  max_reply_chunks?: number
  context_message_limit?: number
}

interface ToolsResponse {
  configured: boolean
  agent_id: string | null
  tools: Record<AgentToolKey, boolean>
  error?: string
}

interface ToolCallRow {
  tool_key: AgentToolKey
  called_at: string
  succeeded: boolean
}

export interface AgentFlowSnapshot {
  config: ConfigResponse
  agentId: string | null
  tools: Record<AgentToolKey, boolean>
  counts: Partial<Record<AgentToolKey, number>>
  /** Up to the last 5 calls per tool, most recent first — powers the live
   *  pulse and the per-node call history in the detail sheet. */
  recentByTool?: Partial<Record<AgentToolKey, ToolCallRow[]>>
}

interface FlowNodeData extends Record<string, unknown> {
  title: string
  detail: string
  description: string
  kind: 'channel' | 'buffer' | 'agent' | 'tool' | 'response'
  count?: number
  toolKey?: AgentToolKey
  targetTab?: AgentTab
  href?: string
  /** True when this tool ran within LIVE_WINDOW_MS — drives the pulsing dot. */
  live?: boolean
  recentCalls?: ToolCallRow[]
  toolEnabled?: boolean
  /** Config field this node can edit inline, and its current value. */
  editableField?: 'buffer_window_seconds' | 'max_reply_chunks'
  editableValue?: number
}

const TOOL_META: Record<
  AgentToolKey,
  { title: string; description: string; icon: typeof Wrench }
> = {
  search_catalog: {
    title: 'Consultar catálogo',
    description: 'Pesquisa produtos, preços, fotografias e stock.',
    icon: Boxes,
  },
  send_product: {
    title: 'Enviar produto',
    description: 'Envia pelo WhatsApp a fotografia de um produto encontrado.',
    icon: Image,
  },
  search_knowledge: {
    title: 'Consultar conhecimento',
    description: 'Pesquisa políticas, serviços e documentação da empresa.',
    icon: BrainCircuit,
  },
  add_tag: {
    title: 'Adicionar tag',
    description: 'Aplica ao contacto uma tag existente na conta.',
    icon: Tags,
  },
  create_deal: {
    title: 'Criar negócio',
    description: 'Cria uma oportunidade aberta no pipeline comercial.',
    icon: BriefcaseBusiness,
  },
  schedule_visit: {
    title: 'Agendar visita',
    description: 'Marca uma data e hora para o cliente visitar a loja ou local físico.',
    icon: CalendarClock,
  },
  get_style_opinion: {
    title: 'Opinião de estilo',
    description: 'Olha fotos reais dos produtos e avalia se combinam com o que a cliente disse sobre si.',
    icon: Sparkles,
  },
  handoff_human: {
    title: 'Encaminhar para humano',
    description: 'Suspende a IA e deixa um motivo estruturado para a equipa.',
    icon: UserRoundCheck,
  },
}

const KIND_STYLE: Record<
  FlowNodeData['kind'],
  { icon: typeof Bot; className: string }
> = {
  channel: { icon: Radio, className: 'border-emerald-500/50 bg-emerald-500/10' },
  buffer: { icon: Clock3, className: 'border-sky-500/50 bg-sky-500/10' },
  agent: { icon: Bot, className: 'border-primary/60 bg-primary/10' },
  tool: { icon: Wrench, className: 'border-amber-500/50 bg-amber-500/10' },
  response: {
    icon: MessageCircleReply,
    className: 'border-fuchsia-500/50 bg-fuchsia-500/10',
  },
}

function AgentFlowNode({ data }: NodeProps) {
  const node = data as FlowNodeData
  const style = KIND_STYLE[node.kind]
  const Icon =
    node.kind === 'tool'
      ? (TOOL_META[
          String(node.toolKey ?? 'search_knowledge') as AgentToolKey
        ]?.icon ?? style.icon)
      : style.icon

  return (
    <div
      className={cn(
        'relative w-[230px] rounded-xl border bg-card px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
        style.className,
        node.kind === 'tool' && node.toolEnabled === false && 'opacity-50',
      )}
    >
      {node.live && (
        <span className="absolute -right-1 -top-1 flex h-3 w-3" title="Actividade nos últimos 5 minutos">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
        </span>
      )}
      {node.kind !== 'channel' && (
        <Handle type="target" position={Position.Left} className="!opacity-0" />
      )}
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-background/80 p-2 text-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">
              {node.title}
            </p>
            {typeof node.count === 'number' && (
              <Badge variant="secondary" className="ml-auto tabular-nums">
                {node.count}
              </Badge>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {node.detail}
          </p>
        </div>
      </div>
      {node.kind !== 'response' && (
        <Handle type="source" position={Position.Right} className="!opacity-0" />
      )}
    </div>
  )
}

const NODE_TYPES = { agentFlow: AgentFlowNode }

export type AgentFlowAccountState = 'loading' | 'ready' | 'unavailable'

export function agentFlowAccountState(
  accountId: string | null,
  profileLoading: boolean,
): AgentFlowAccountState {
  if (accountId) return 'ready'
  return profileLoading ? 'loading' : 'unavailable'
}

export function buildAgentFlowGraph(snapshot: AgentFlowSnapshot): {
  nodes: Node<FlowNodeData>[]
  edges: Edge[]
} {
  const { config, tools, counts, recentByTool } = snapshot
  const allToolKeys = (Object.keys(tools) as AgentToolKey[]).filter(
    (key) => key in TOOL_META,
  )
  const activeTools = allToolKeys.filter((key) => tools[key])
  const now = Date.now()
  const raw: Array<{ id: string; data: FlowNodeData }> = [
    {
      id: 'whatsapp',
      data: {
        title: 'WhatsApp',
        detail: 'Canal de entrada',
        description: 'Mensagens recebidas pela WhatsApp Cloud API.',
        kind: 'channel',
        href: '/settings',
      },
    },
    {
      id: 'buffer',
      data: {
        title: 'Buffer',
        detail: `${config.buffer_window_seconds ?? 12}s de janela`,
        description:
          'Agrupa fragmentos rápidos do cliente antes de activar o agente. Ajuste directamente aqui.',
        kind: 'buffer',
        targetTab: 'runtime',
        editableField: 'buffer_window_seconds',
        editableValue: config.buffer_window_seconds ?? 12,
      },
    },
    {
      id: 'agent',
      data: {
        title: 'Agente',
        detail: `${config.model ?? 'Não configurado'} · ${config.context_message_limit ?? 20} mensagens`,
        description:
          'Modelo activo, contexto recente, memória CRM e regras do negócio.',
        kind: 'agent',
        targetTab: 'runtime',
      },
    },
    // Every known tool gets a node — not just the enabled ones — so the
    // canvas doubles as the place to turn a skill on, not only watch the
    // ones already active. Disabled tools render dimmed and are excluded
    // from the wired pipeline below.
    ...allToolKeys.map((toolKey) => {
      const recentCalls = recentByTool?.[toolKey] ?? []
      const lastCallAt = recentCalls[0]?.called_at
      return {
        id: `tool:${toolKey}`,
        data: {
          title: TOOL_META[toolKey].title,
          detail: tools[toolKey]
            ? `${counts[toolKey] ?? 0} chamadas em 30 dias`
            : 'Desligada',
          description: TOOL_META[toolKey].description,
          kind: 'tool' as const,
          count: counts[toolKey] ?? 0,
          targetTab: 'tools' as const,
          toolKey,
          toolEnabled: tools[toolKey],
          live: Boolean(lastCallAt && now - new Date(lastCallAt).getTime() < LIVE_WINDOW_MS),
          recentCalls,
        },
      }
    }),
    {
      id: 'response',
      data: {
        title: 'Resposta',
        detail: `Até ${config.max_reply_chunks ?? 3} balões`,
        description:
          'Indicador de escrita, pausas naturais e envio ordenado ao cliente. Ajuste directamente aqui.',
        kind: 'response',
        targetTab: 'runtime',
        editableField: 'max_reply_chunks',
        editableValue: config.max_reply_chunks ?? 3,
      },
    },
  ]

  const edges: Edge[] = [
    { id: 'whatsapp-buffer', source: 'whatsapp', target: 'buffer' },
    { id: 'buffer-agent', source: 'buffer', target: 'agent' },
    ...(activeTools.length > 0
      ? activeTools.flatMap((toolKey) => [
          {
            id: `agent-${toolKey}`,
            source: 'agent',
            target: `tool:${toolKey}`,
          },
          {
            id: `${toolKey}-response`,
            source: `tool:${toolKey}`,
            target: 'response',
          },
        ])
      : [{ id: 'agent-response', source: 'agent', target: 'response' }]),
  ].map((edge) => ({
    ...edge,
    type: 'smoothstep',
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: 'var(--border)' },
  }))

  const positions = autoLayout(
    raw.map((node) => ({ id: node.id, width: 230, height: 92 })),
    edges.map((edge) => ({ source: edge.source, target: edge.target })),
    { direction: 'LR', rankSep: 90, nodeSep: 28, defaultWidth: 230 },
  )

  return {
    nodes: raw.map((node) => ({
      id: node.id,
      type: 'agentFlow',
      data: node.data,
      position: positions.get(node.id) ?? { x: 0, y: 0 },
    })),
    edges,
  }
}

export function AgentFlowPanel({
  onOpenTab,
}: {
  onOpenTab: (tab: AgentTab) => void
}) {
  const { accountId, profileLoading } = useAuth()
  const [snapshot, setSnapshot] = useState<AgentFlowSnapshot | null>(null)
  const [selected, setSelected] = useState<FlowNodeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [tick, setTick] = useState(0)
  const [draftValue, setDraftValue] = useState<number | null>(null)
  const [patchStatus, setPatchStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [patchError, setPatchError] = useState<string | null>(null)
  const loadAbortRef = useRef<AbortController | null>(null)

  // Re-derives `live` (activity within LIVE_WINDOW_MS) as time passes, even
  // without a new tool call arriving to trigger a snapshot update.
  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const load = useCallback(async () => {
    const accountState = agentFlowAccountState(accountId, profileLoading)
    if (accountState === 'loading') return
    if (accountState === 'unavailable') {
      setSnapshot(null)
      setError('Não foi possível identificar a conta actual. Actualize a página ou volte a iniciar sessão.')
      setLoading(false)
      return
    }

    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    let timedOut = false
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 15_000)
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const [configResponse, toolsResponse, callsResult] = await Promise.all([
        fetch('/api/ai/config', { cache: 'no-store', signal: controller.signal }),
        fetch('/api/ai/tools', { cache: 'no-store', signal: controller.signal }),
        supabase
          .from('agent_tool_calls')
          .select('tool_key, called_at, succeeded')
          .eq('account_id', accountId)
          .gte('called_at', since)
          .order('called_at', { ascending: false })
          .limit(5000)
          .abortSignal(controller.signal),
      ])
      const config = (await configResponse.json().catch(() => ({}))) as ConfigResponse & {
        error?: string
      }
      const toolState = (await toolsResponse.json()) as ToolsResponse
      if (!configResponse.ok)
        throw new Error(config.error ?? 'Não foi possível carregar a configuração do agente.')
      if (!toolsResponse.ok)
        throw new Error(toolState.error ?? 'Não foi possível carregar as ferramentas do agente.')
      if (callsResult.error)
        throw new Error(`Não foi possível carregar a actividade do agente: ${callsResult.error.message}`)
      const counts: Partial<Record<AgentToolKey, number>> = {}
      const recentByTool: Partial<Record<AgentToolKey, ToolCallRow[]>> = {}
      // Rows arrive most-recent-first (order: called_at desc), so the first
      // 5 seen per tool are already its most recent calls.
      for (const row of (callsResult.data ?? []) as ToolCallRow[]) {
        counts[row.tool_key] = (counts[row.tool_key] ?? 0) + 1
        const existing = recentByTool[row.tool_key] ?? []
        if (existing.length < 5) recentByTool[row.tool_key] = [...existing, row]
      }
      setSnapshot({
        config,
        agentId: toolState.agent_id,
        tools: toolState.tools,
        counts,
        recentByTool,
      })
    } catch (loadError) {
      if (controller.signal.aborted) {
        if (loadAbortRef.current !== controller) return
        setError(
          timedOut
            ? 'O carregamento do fluxo demorou demasiado. Tente novamente.'
            : 'O carregamento do fluxo foi interrompido. Tente novamente.',
        )
        return
      }
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Não foi possível carregar o fluxo do agente.',
      )
    } finally {
      window.clearTimeout(timeoutId)
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null
        setLoading(false)
      }
    }
  }, [accountId, profileLoading])

  useEffect(() => {
    void load()
    return () => {
      const activeLoad = loadAbortRef.current
      loadAbortRef.current = null
      activeLoad?.abort()
    }
  }, [load])

  useEffect(() => {
    if (!accountId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`agent-tool-calls:${accountId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'wacrm',
          table: 'agent_tool_calls',
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const row = payload.new as ToolCallRow
          setSnapshot((current) =>
            current
              ? {
                  ...current,
                  counts: {
                    ...current.counts,
                    [row.tool_key]: (current.counts[row.tool_key] ?? 0) + 1,
                  },
                  recentByTool: {
                    ...current.recentByTool,
                    [row.tool_key]: [
                      row,
                      ...(current.recentByTool?.[row.tool_key] ?? []),
                    ].slice(0, 5),
                  },
                }
              : current,
          )
        },
      )
      .subscribe((status) => setIsConnected(status === 'SUBSCRIBED'))

    return () => {
      void supabase.removeChannel(channel)
      setIsConnected(false)
    }
  }, [accountId])

  useEffect(() => {
    setDraftValue(selected?.editableValue ?? null)
    setPatchStatus('idle')
    setPatchError(null)
  }, [selected])

  const saveEditableField = useCallback(
    async (field: 'buffer_window_seconds' | 'max_reply_chunks', value: number) => {
      setPatchStatus('saving')
      setPatchError(null)
      try {
        const response = await fetch('/api/ai/config', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: value }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error ?? 'Não foi possível guardar.')
        setSnapshot((current) =>
          current ? { ...current, config: { ...current.config, [field]: value } } : current,
        )
        setSelected((current) =>
          current ? { ...current, detail: current.detail, editableValue: value } : current,
        )
        setPatchStatus('saved')
      } catch (err) {
        setPatchStatus('error')
        setPatchError(err instanceof Error ? err.message : 'Não foi possível guardar.')
      }
    },
    [],
  )

  const toggleTool = useCallback(async (toolKey: AgentToolKey, nextEnabled: boolean) => {
    setPatchStatus('saving')
    setPatchError(null)
    try {
      const response = await fetch('/api/ai/tools', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_key: toolKey, enabled: nextEnabled }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível guardar.')
      setSnapshot((current) =>
        current
          ? { ...current, tools: { ...current.tools, [toolKey]: nextEnabled } }
          : current,
      )
      setSelected((current) =>
        current ? { ...current, toolEnabled: nextEnabled } : current,
      )
      setPatchStatus('saved')
    } catch (err) {
      setPatchStatus('error')
      setPatchError(err instanceof Error ? err.message : 'Não foi possível guardar.')
    }
  }, [])

  const graph = useMemo(
    () => (snapshot ? buildAgentFlowGraph(snapshot) : null),
    [snapshot, tick],
  )

  if (loading) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> A carregar o fluxo…
      </div>
    )
  }

  if (error || !snapshot || !graph) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6">
        <p className="text-sm text-destructive">{error ?? 'Fluxo indisponível.'}</p>
        <Button variant="outline" className="mt-4" onClick={() => void load()}>
          Tentar novamente
        </Button>
      </div>
    )
  }

  if (!snapshot.config.configured) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <Bot className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="mt-3 font-semibold text-foreground">Agente ainda não configurado</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Guarde primeiro o fornecedor, modelo e chave do agente.
        </p>
        <Button className="mt-4" onClick={() => onOpenTab('runtime')}>
          Abrir configuração
        </Button>
      </div>
    )
  }

  const totalCalls = Object.values(snapshot.counts).reduce(
    (total, count) => total + (count ?? 0),
    0,
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div>
          <p className="text-sm font-medium text-foreground">Arquitectura activa</p>
          <p className="text-xs text-muted-foreground">
            {snapshot.config.provider} · {snapshot.config.model} · {totalCalls} chamadas de ferramenta em 30 dias
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isConnected ? 'secondary' : 'outline'}>
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                isConnected ? 'bg-emerald-500' : 'bg-muted-foreground',
              )}
            />
            {isConnected ? 'Ao vivo' : 'A ligar'}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw /> Actualizar
          </Button>
        </div>
      </div>

      <div className="h-[600px] overflow-hidden rounded-xl border border-border bg-muted/20">
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.35}
          maxZoom={1.4}
          onNodeClick={(_, node) => setSelected(node.data as FlowNodeData)}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent>
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.title}</SheetTitle>
                <SheetDescription>{selected.description}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4">
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Estado actual
                  </p>
                  <p className="mt-1 text-sm text-foreground">{selected.detail}</p>
                </div>

                {selected.kind === 'tool' && selected.toolKey && (
                  <div className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">Ferramenta activa</p>
                        <p className="text-xs text-muted-foreground">
                          O agente só pode usar esta capacidade se estiver ligada.
                        </p>
                      </div>
                      <Switch
                        checked={selected.toolEnabled ?? false}
                        onCheckedChange={(checked) => {
                          void toggleTool(selected.toolKey!, checked)
                        }}
                        disabled={patchStatus === 'saving'}
                      />
                    </div>
                  </div>
                )}

                {selected.editableField && (
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium text-foreground">
                      {selected.editableField === 'buffer_window_seconds'
                        ? 'Janela do buffer (segundos)'
                        : 'Máximo de balões por resposta'}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={selected.editableField === 'buffer_window_seconds' ? 30 : 5}
                        value={draftValue ?? ''}
                        onChange={(event) => setDraftValue(Number(event.target.value))}
                        className="w-24"
                      />
                      <Button
                        size="sm"
                        disabled={
                          patchStatus === 'saving' ||
                          draftValue === null ||
                          draftValue === selected.editableValue
                        }
                        onClick={() => {
                          if (draftValue !== null) void saveEditableField(selected.editableField!, draftValue)
                        }}
                      >
                        {patchStatus === 'saving' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Guardar'
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {patchStatus === 'saved' && (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-600">
                    <Check className="h-3.5 w-3.5" /> Guardado.
                  </p>
                )}
                {patchStatus === 'error' && (
                  <p className="text-xs text-destructive">{patchError}</p>
                )}

                {selected.kind === 'tool' && (
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Últimas chamadas
                    </p>
                    {selected.recentCalls && selected.recentCalls.length > 0 ? (
                      <ul className="space-y-1.5">
                        {selected.recentCalls.map((call, index) => (
                          <li
                            key={`${call.called_at}-${index}`}
                            className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-1.5 text-xs"
                          >
                            <span className="text-muted-foreground">
                              {CALL_TIME_FORMATTER.format(new Date(call.called_at))}
                            </span>
                            {call.succeeded ? (
                              <span className="flex items-center gap-1 text-emerald-600">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Sucesso
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-destructive">
                                <XCircle className="h-3.5 w-3.5" /> Falhou
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Ainda sem chamadas registadas nos últimos 30 dias.
                      </p>
                    )}
                  </div>
                )}

                {selected.href ? (
                  <Link
                    href={selected.href}
                    className={buttonVariants({ variant: 'outline', className: 'w-full' })}
                  >
                    Abrir definições do canal
                  </Link>
                ) : selected.targetTab ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      onOpenTab(selected.targetTab!)
                      setSelected(null)
                    }}
                  >
                    Abrir configuração completa
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
