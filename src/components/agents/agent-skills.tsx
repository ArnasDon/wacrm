'use client'

import { useCallback, useEffect, useState } from 'react'
import { Layers, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { CollapsibleEditor } from '@/components/ui/collapsible-editor'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useCan } from '@/hooks/use-can'
import { AGENT_TOOL_KEYS, type AgentToolKey } from '@/lib/ai/tool-permissions'

const TOOL_LABELS: Record<AgentToolKey, string> = {
  search_catalog: 'Consultar catálogo',
  send_product: 'Enviar produtos',
  search_knowledge: 'Consultar conhecimento',
  add_tag: 'Adicionar tag',
  create_deal: 'Criar negócio',
  schedule_visit: 'Agendar visita',
  get_style_opinion: 'Opinião de estilo',
  handoff_human: 'Encaminhar para humano',
}

interface Skill {
  id: string
  name: string
  instructions: string
  objective: string | null
  when_to_use: string | null
  when_not_to_use: string | null
  tool_keys: AgentToolKey[]
  enabled: boolean
  sort_order: number
}

interface SkillDraft {
  name: string
  instructions: string
  objective: string
  whenToUse: string
  whenNotToUse: string
  toolKeys: AgentToolKey[]
  enabled: boolean
}

function toDraft(skill: Skill): SkillDraft {
  return {
    name: skill.name,
    instructions: skill.instructions,
    objective: skill.objective ?? '',
    whenToUse: skill.when_to_use ?? '',
    whenNotToUse: skill.when_not_to_use ?? '',
    toolKeys: skill.tool_keys,
    enabled: skill.enabled,
  }
}

export function AgentSkills() {
  const canEdit = useCan('edit-settings')
  const [configured, setConfigured] = useState(true)
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SkillDraft | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/ai/skills', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível carregar as skills.')
      setConfigured(Boolean(data.configured))
      setSkills((data.skills ?? []) as Skill[])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar as skills.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function startEdit(skill: Skill) {
    setDraft(toDraft(skill))
    setEditingId(skill.id)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft(null)
  }

  const createSkill = async () => {
    const name = newName.trim()
    if (!name) return
    setSavingId('__new__')
    try {
      const response = await fetch('/api/ai/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, instructions: '', tool_keys: [] }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível criar a skill.')
      setSkills((current) => [...current, data.skill as Skill])
      setNewName('')
      setCreating(false)
      toast.success('Skill criada.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar a skill.')
    } finally {
      setSavingId(null)
    }
  }

  const saveSkill = async (id: string) => {
    if (!draft) return
    setSavingId(id)
    try {
      const response = await fetch(`/api/ai/skills/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          instructions: draft.instructions,
          objective: draft.objective,
          when_to_use: draft.whenToUse,
          when_not_to_use: draft.whenNotToUse,
          tool_keys: draft.toolKeys,
          enabled: draft.enabled,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível guardar a skill.')
      const skill = data.skill as Skill
      setSkills((current) => current.map((item) => (item.id === id ? skill : item)))
      toast.success('Skill guardada.')
      cancelEdit()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível guardar a skill.')
    } finally {
      setSavingId(null)
    }
  }

  const deleteSkill = async (id: string) => {
    if (!confirm('Apagar esta skill?')) return
    setSavingId(id)
    try {
      const response = await fetch(`/api/ai/skills/${id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível apagar a skill.')
      setSkills((current) => current.filter((item) => item.id !== id))
      cancelEdit()
      toast.success('Skill apagada.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível apagar a skill.')
    } finally {
      setSavingId(null)
    }
  }

  function updateDraft(patch: Partial<SkillDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current))
  }

  function toggleDraftTool(key: AgentToolKey, checked: boolean) {
    if (!draft) return
    const toolKeys = checked ? [...draft.toolKeys.filter((k) => k !== key), key] : draft.toolKeys.filter((k) => k !== key)
    updateDraft({ toolKeys })
  }

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Skills</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada skill é um objectivo (venda, qualificação, pós-venda...) com o seu próprio texto de
          instrução e o subconjunto de ferramentas que lhe interessa. Sem nenhuma skill criada, o
          agente comporta-se exactamente como hoje — um único prompt e as ferramentas activas em
          “Ferramentas”. Uma ferramenta só fica disponível para uma skill se também estiver activada
          em “Ferramentas”; a skill só pode restringir, nunca alargar essa permissão.
        </p>
      </div>

      {!configured && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Configure primeiro o agente de IA.
        </div>
      )}

      <div className="space-y-3">
        {skills.map((skill) => {
          const editing = editingId === skill.id
          const activeDraft = editing ? draft : null
          const disabled = !canEdit || !configured

          return (
            <CollapsibleEditor
              key={skill.id}
              editing={editing}
              canEdit={!disabled}
              onToggle={() => (editing ? cancelEdit() : startEdit(skill))}
              onCancel={cancelEdit}
              onSave={() => saveSkill(skill.id)}
              saving={savingId === skill.id}
              header={
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{skill.name}</span>
                    <Badge variant={skill.enabled ? 'default' : 'outline'}>{skill.enabled ? 'ACTIVA' : 'INACTIVA'}</Badge>
                  </div>
                  {skill.objective ? <p className="truncate text-sm text-muted-foreground">{skill.objective}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {skill.tool_keys.length} ferramenta{skill.tool_keys.length === 1 ? '' : 's'}
                  </p>
                </div>
              }
            >
              {activeDraft ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Nome</label>
                    <Input value={activeDraft.name} onChange={(e) => updateDraft({ name: e.target.value })} className="font-medium" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Objectivo</label>
                    <Input
                      value={activeDraft.objective}
                      onChange={(e) => updateDraft({ objective: e.target.value })}
                      placeholder="Ex.: Ajudar um cliente com intenção comercial a avançar para uma decisão."
                      className="text-sm"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Usa quando</label>
                      <Textarea
                        value={activeDraft.whenToUse}
                        onChange={(e) => updateDraft({ whenToUse: e.target.value })}
                        placeholder="Ex.: Existe interesse real num produto."
                        rows={2}
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Não uses quando</label>
                      <Textarea
                        value={activeDraft.whenNotToUse}
                        onChange={(e) => updateDraft({ whenNotToUse: e.target.value })}
                        placeholder="Ex.: Cumprimentos ou curiosidade genérica."
                        rows={2}
                        className="text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Instruções</label>
                    <Textarea
                      value={activeDraft.instructions}
                      onChange={(e) => updateDraft({ instructions: e.target.value })}
                      placeholder="Ex.: Quando o cliente já escolheu produto e tamanho, conduz para o fecho da venda — resume o pedido e pergunta se quer confirmar."
                      rows={3}
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Ferramentas desta skill</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {AGENT_TOOL_KEYS.map((key) => (
                        <label key={key} className="flex items-center gap-1.5 text-sm text-foreground">
                          <Checkbox checked={activeDraft.toolKeys.includes(key)} onCheckedChange={(checked) => toggleDraftTool(key, checked === true)} />
                          {TOOL_LABELS[key]}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t pt-3">
                    <div className="flex items-center gap-2">
                      <Switch checked={activeDraft.enabled} onCheckedChange={(enabled) => updateDraft({ enabled })} id={`skill-enabled-${skill.id}`} />
                      <label htmlFor={`skill-enabled-${skill.id}`} className="text-sm">
                        Activa
                      </label>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => void deleteSkill(skill.id)} className="text-destructive hover:text-destructive">
                      <Trash2 />
                      Apagar skill
                    </Button>
                  </div>
                </>
              ) : null}
            </CollapsibleEditor>
          )
        })}
      </div>

      {creating ? (
        <Card>
          <CardContent className="flex items-center gap-2 pt-6">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome da skill, ex.: Vendas"
              disabled={savingId !== null}
              autoFocus
            />
            <Button onClick={() => void createSkill()} disabled={savingId !== null || !newName.trim()}>
              {savingId === '__new__' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)} disabled={savingId !== null}>
              Cancelar
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" onClick={() => setCreating(true)} disabled={!canEdit || !configured}>
          <Plus className="mr-2 h-4 w-4" /> Nova skill
        </Button>
      )}
    </div>
  )
}
