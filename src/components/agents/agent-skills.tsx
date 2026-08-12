'use client'

import { useCallback, useEffect, useState } from 'react'
import { Layers, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
}

function toDraft(skill: Skill): SkillDraft {
  return {
    name: skill.name,
    instructions: skill.instructions,
    objective: skill.objective ?? '',
    whenToUse: skill.when_to_use ?? '',
    whenNotToUse: skill.when_not_to_use ?? '',
    toolKeys: skill.tool_keys,
  }
}

function draftsEqual(a: SkillDraft, b: SkillDraft): boolean {
  return (
    a.name === b.name &&
    a.instructions === b.instructions &&
    a.objective === b.objective &&
    a.whenToUse === b.whenToUse &&
    a.whenNotToUse === b.whenNotToUse &&
    a.toolKeys.length === b.toolKeys.length &&
    a.toolKeys.every((key) => b.toolKeys.includes(key))
  )
}

export function AgentSkills() {
  const canEdit = useCan('edit-settings')
  const [configured, setConfigured] = useState(true)
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, SkillDraft>>({})
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/ai/skills', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível carregar as skills.')
      setConfigured(Boolean(data.configured))
      const rows = (data.skills ?? []) as Skill[]
      setSkills(rows)
      setDrafts(Object.fromEntries(rows.map((skill) => [skill.id, toDraft(skill)])))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar as skills.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
      const skill = data.skill as Skill
      setSkills((current) => [...current, skill])
      setDrafts((current) => ({ ...current, [skill.id]: toDraft(skill) }))
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
    const draft = drafts[id]
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
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível guardar a skill.')
      const skill = data.skill as Skill
      setSkills((current) => current.map((item) => (item.id === id ? skill : item)))
      setDrafts((current) => ({ ...current, [id]: toDraft(skill) }))
      toast.success('Skill guardada.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível guardar a skill.')
    } finally {
      setSavingId(null)
    }
  }

  const toggleEnabled = async (id: string, enabled: boolean) => {
    setSavingId(id)
    setSkills((current) =>
      current.map((item) => (item.id === id ? { ...item, enabled } : item)),
    )
    try {
      const response = await fetch(`/api/ai/skills/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível actualizar a skill.')
      toast.success(enabled ? 'Skill activada.' : 'Skill desactivada.')
    } catch (error) {
      setSkills((current) =>
        current.map((item) => (item.id === id ? { ...item, enabled: !enabled } : item)),
      )
      toast.error(error instanceof Error ? error.message : 'Não foi possível actualizar a skill.')
    } finally {
      setSavingId(null)
    }
  }

  const deleteSkill = async (id: string) => {
    setSavingId(id)
    try {
      const response = await fetch(`/api/ai/skills/${id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível apagar a skill.')
      setSkills((current) => current.filter((item) => item.id !== id))
      setDrafts((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      toast.success('Skill apagada.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível apagar a skill.')
    } finally {
      setSavingId(null)
    }
  }

  const updateDraft = (id: string, patch: Partial<SkillDraft>) => {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  }

  const toggleDraftTool = (id: string, key: AgentToolKey, checked: boolean) => {
    const draft = drafts[id]
    if (!draft) return
    const toolKeys = checked
      ? [...draft.toolKeys.filter((k) => k !== key), key]
      : draft.toolKeys.filter((k) => k !== key)
    updateDraft(id, { toolKeys })
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
          const draft = drafts[skill.id] ?? toDraft(skill)
          const dirty = !draftsEqual(draft, toDraft(skill))
          const disabled = !canEdit || !configured || savingId !== null

          return (
            <Card key={skill.id}>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div className="flex-1 space-y-2">
                  <Input
                    value={draft.name}
                    onChange={(e) => updateDraft(skill.id, { name: e.target.value })}
                    disabled={disabled}
                    className="max-w-sm font-medium"
                  />
                  <CardDescription>
                    Texto acrescentado ao comportamento do agente apenas quando esta skill está
                    activa.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={skill.enabled}
                    disabled={disabled}
                    onCheckedChange={(enabled) => void toggleEnabled(skill.id, enabled)}
                    aria-label={`Activar ${skill.name}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    onClick={() => void deleteSkill(skill.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Objectivo</label>
                  <Input
                    value={draft.objective}
                    onChange={(e) => updateDraft(skill.id, { objective: e.target.value })}
                    placeholder="Ex.: Ajudar um cliente com intenção comercial a avançar para uma decisão."
                    disabled={disabled}
                    className="text-sm"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Usa quando</label>
                    <Textarea
                      value={draft.whenToUse}
                      onChange={(e) => updateDraft(skill.id, { whenToUse: e.target.value })}
                      placeholder="Ex.: Existe interesse real num produto."
                      disabled={disabled}
                      rows={2}
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Não uses quando
                    </label>
                    <Textarea
                      value={draft.whenNotToUse}
                      onChange={(e) => updateDraft(skill.id, { whenNotToUse: e.target.value })}
                      placeholder="Ex.: Cumprimentos ou curiosidade genérica."
                      disabled={disabled}
                      rows={2}
                      className="text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Instruções</label>
                  <Textarea
                    value={draft.instructions}
                    onChange={(e) => updateDraft(skill.id, { instructions: e.target.value })}
                    placeholder="Ex.: Quando o cliente já escolheu produto e tamanho, conduz para o fecho da venda — resume o pedido e pergunta se quer confirmar."
                    disabled={disabled}
                    rows={3}
                    className="text-sm"
                  />
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Ferramentas desta skill
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {AGENT_TOOL_KEYS.map((key) => (
                      <label
                        key={key}
                        className="flex items-center gap-1.5 text-sm text-foreground"
                      >
                        <Checkbox
                          checked={draft.toolKeys.includes(key)}
                          disabled={disabled}
                          onCheckedChange={(checked) =>
                            toggleDraftTool(skill.id, key, checked === true)
                          }
                        />
                        {TOOL_LABELS[key]}
                      </label>
                    ))}
                  </div>
                </div>
                {dirty && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={savingId !== null}
                    onClick={() => void saveSkill(skill.id)}
                  >
                    {savingId === skill.id && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                    Guardar
                  </Button>
                )}
              </CardContent>
            </Card>
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
            <Button
              onClick={() => void createSkill()}
              disabled={savingId !== null || !newName.trim()}
            >
              {savingId === '__new__' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)} disabled={savingId !== null}>
              Cancelar
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Button
          variant="outline"
          onClick={() => setCreating(true)}
          disabled={!canEdit || !configured}
        >
          <Plus className="mr-2 h-4 w-4" /> Nova skill
        </Button>
      )}
    </div>
  )
}
