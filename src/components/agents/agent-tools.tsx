'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  Image,
  Loader2,
  Tags,
  UserRoundCheck,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useCan } from '@/hooks/use-can'

interface ToolState {
  configured: boolean
  agent_id: string | null
  tools: {
    search_catalog: boolean
    send_product: boolean
    search_knowledge: boolean
    add_tag: boolean
    create_deal: boolean
    handoff_human: boolean
  }
}

type ToolKey = keyof ToolState['tools']

const TOOL_COPY: Record<
  ToolKey,
  { title: string; description: string; icon: typeof Boxes }
> = {
  search_catalog: {
    title: 'Consultar catálogo',
    description:
      'Permite ao agente pesquisar produtos, preços, stock e ligações no catálogo interno e nas APIs externas activas.',
    icon: Boxes,
  },
  send_product: {
    title: 'Enviar produtos',
    description:
      'Permite ao agente enviar pelo WhatsApp a fotografia de um produto encontrado no catálogo.',
    icon: Image,
  },
  search_knowledge: {
    title: 'Consultar conhecimento',
    description:
      'Permite ao agente pesquisar documentos, FAQs, políticas e informação interna da empresa.',
    icon: BookOpen,
  },
  add_tag: {
    title: 'Adicionar tag ao contacto',
    description:
      'Permite ao agente aplicar ao contacto uma tag já existente nesta conta.',
    icon: Tags,
  },
  create_deal: {
    title: 'Criar negócio no pipeline',
    description:
      'Permite ao agente captar uma oportunidade e criar um negócio na primeira etapa do pipeline.',
    icon: BriefcaseBusiness,
  },
  handoff_human: {
    title: 'Encaminhar para atendimento humano',
    description:
      'Permite ao agente suspender a resposta automática e registar um motivo estruturado para a equipa.',
    icon: UserRoundCheck,
  },
}

export function AgentTools() {
  const canEdit = useCan('edit-settings')
  const [state, setState] = useState<ToolState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<ToolKey | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/ai/tools', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível carregar as ferramentas.')
      setState(data as ToolState)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar as ferramentas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (toolKey: ToolKey, enabled: boolean) => {
    if (!state || saving) return
    setSaving(toolKey)
    const previous = state.tools[toolKey]
    setState((current) =>
      current
        ? { ...current, tools: { ...current.tools, [toolKey]: enabled } }
        : current,
    )
    try {
      const response = await fetch('/api/ai/tools', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_key: toolKey, enabled }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível actualizar a ferramenta.')
      toast.success(enabled ? 'Ferramenta activada.' : 'Ferramenta desactivada.')
    } catch (error) {
      setState((current) =>
        current
          ? { ...current, tools: { ...current.tools, [toolKey]: previous } }
          : current,
      )
      toast.error(error instanceof Error ? error.message : 'Não foi possível actualizar a ferramenta.')
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!state) return null

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Ferramentas</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Defina exactamente aquilo que este agente pode consultar ou executar durante uma conversa.
        </p>
      </div>

      {!state.configured && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Configure e guarde primeiro o agente de IA.
        </div>
      )}

      <div className="space-y-3">
        {(Object.keys(TOOL_COPY) as ToolKey[]).map((toolKey) => {
          const item = TOOL_COPY[toolKey]
          const Icon = item.icon
          const dependencyBlocked =
            toolKey === 'send_product' && !state.tools.search_catalog
          const disabled =
            !canEdit || !state.configured || saving !== null || dependencyBlocked

          return (
            <Card key={toolKey}>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div className="flex gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <CardDescription className="mt-1 max-w-2xl">
                      {item.description}
                    </CardDescription>
                  </div>
                </div>
                <Switch
                  checked={state.tools[toolKey]}
                  disabled={disabled}
                  onCheckedChange={(enabled) => void toggle(toolKey, enabled)}
                  aria-label={item.title}
                />
              </CardHeader>
              {dependencyBlocked && (
                <CardContent className="pt-0 text-xs text-muted-foreground">
                  Active primeiro “Consultar catálogo”.
                </CardContent>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
