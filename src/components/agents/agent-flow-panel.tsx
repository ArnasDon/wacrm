'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  Clock3,
  Image,
  MessageCircleReply,
  Radio,
  RefreshCw,
  Tags,
  UserRoundCheck,
  Wrench,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { autoLayout } from '@/lib/flows/layout'
import type { AgentToolKey } from '@/lib/ai/tool-permissions'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useAuth } from '@/hooks/use-auth'

type AgentTab = 'setup' | 'tools' | 'usage'

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
        'w-[230px] rounded-xl border bg-card px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
        style.className,
      )}
    >
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

export function buildAgentFlowGraph(snapshot: AgentFlowSnapshot): {
  nodes: Node<FlowNodeData>[]
  edges: Edge[]
} {
  const { config, tools, counts } = snapshot
  const activeTools = (Object.keys(tools) as AgentToolKey[]).filter(
    (key) => tools[key],
  )
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
          'Agrupa fragmentos rápidos do cliente antes de activar o agente.',
        kind: 'buffer',
        targetTab: 'setup',
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
        targetTab: 'setup',
      },
    },
    ...activeTools.map((toolKey) => ({
      id: `tool:${toolKey}`,
      data: {
        title: TOOL_META[toolKey].title,
        detail: `${counts[toolKey] ?? 0} chamadas em 30 dias`,
        description: TOOL_META[toolKey].description,
        kind: 'tool' as const,
        count: counts[toolKey] ?? 0,
        targetTab: 'tools' as const,
        toolKey,
      },
    })),
    {
      id: 'response',
      data: {
        title: 'Resposta',
        detail: `Até ${config.max_reply_chunks ?? 3} balões`,
        description:
          'Indicador de escrita, pausas naturais e envio ordenado ao cliente.',
        kind: 'response',
        targetTab: 'setup',
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
  const { account } = useAuth()
  const [snapshot, setSnapshot] = useState<AgentFlowSnapshot | null>(null)
  const [selected, setSelected] = useState<FlowNodeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  const load = useCallback(async () => {
    if (!account?.id) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const [configResponse, toolsResponse, callsResult] = await Promise.all([
        fetch('/api/ai/config'),
        fetch('/api/ai/tools'),
        supabase
          .from('agent_tool_calls')
          .select('tool_key, called_at, succeeded')
          .eq('account_id', account.id)
          .gte('called_at', since)
          .order('called_at', { ascending: false })
          .limit(5000),
      ])
      const config = (await configResponse.json()) as ConfigResponse
      const toolState = (await toolsResponse.json()) as ToolsResponse
      if (!configResponse.ok || !toolsResponse.ok || callsResult.error) {
        throw new Error('Não foi possível carregar o fluxo do agente.')
      }
      const counts: Partial<Record<AgentToolKey, number>> = {}
      for (const row of (callsResult.data ?? []) as ToolCallRow[]) {
        counts[row.tool_key] = (counts[row.tool_key] ?? 0) + 1
      }
      setSnapshot({
        config,
        agentId: toolState.agent_id,
        tools: toolState.tools,
        counts,
      })
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Não foi possível carregar o fluxo do agente.',
      )
    } finally {
      setLoading(false)
    }
  }, [account?.id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!account?.id) return
    const supabase = createClient()
    const channel = supabase
      .channel(`agent-tool-calls:${account.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'wacrm',
          table: 'agent_tool_calls',
          filter: `account_id=eq.${account.id}`,
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
  }, [account?.id])

  const graph = useMemo(
    () => (snapshot ? buildAgentFlowGraph(snapshot) : null),
    [snapshot],
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
        <Button className="mt-4" onClick={() => onOpenTab('setup')}>
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
                {selected.href ? (
                  <Link
                    href={selected.href}
                    className={buttonVariants({ className: 'w-full' })}
                  >
                    Abrir definições do canal
                  </Link>
                ) : selected.targetTab ? (
                  <Button
                    className="w-full"
                    onClick={() => {
                      onOpenTab(selected.targetTab!)
                      setSelected(null)
                    }}
                  >
                    Abrir configuração
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
