'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Tags, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CollapsibleEditor } from '@/components/ui/collapsible-editor'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface TaxonomyTerm {
  id: string
  kind: 'category' | 'color'
  canonical_value: string
  aliases: string[]
  enabled: boolean
  productCount: number
}

function parseAliases(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  )
}

/**
 * No-code UX over wacrm.catalog_taxonomy_terms: an admin creates and
 * edits their own account's category/colour vocabulary here — no SQL,
 * no migration, no code change. Everything is scoped by account_id
 * server-side (see /api/catalog/taxonomy); this component never sees
 * another tenant's terms.
 */
export function TaxonomyManager() {
  const [terms, setTerms] = useState<TaxonomyTerm[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/catalog/taxonomy', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível carregar as categorias.')
      setTerms(body.terms ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao carregar categorias.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createTerm(kind: 'category' | 'color', canonicalValue: string, aliases: string[]): Promise<boolean> {
    try {
      const response = await fetch('/api/catalog/taxonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, canonical_value: canonicalValue, aliases }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível criar.')
      setTerms((current) => [...current, body.term])
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar.')
      return false
    }
  }

  async function updateTerm(id: string, patch: { canonical_value?: string; aliases?: string[]; enabled?: boolean }) {
    const response = await fetch(`/api/catalog/taxonomy/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? 'Não foi possível guardar.')
    setTerms((current) => current.map((term) => (term.id === id ? { ...term, ...body.term } : term)))
  }

  async function deleteTerm(id: string) {
    const response = await fetch(`/api/catalog/taxonomy/${id}`, { method: 'DELETE' })
    if (!response.ok) {
      toast.error('Não foi possível remover.')
      return
    }
    setTerms((current) => current.filter((term) => term.id !== id))
    toast.success('Removida.')
  }

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <TaxonomySection
        kind="category"
        title="Categorias"
        emptyTitle="Ainda não tens categorias."
        emptyDescription="Cria as categorias que fazem sentido para o teu negócio. A IA usará estas categorias para organizar e encontrar os teus produtos."
        newLabel="Nova categoria"
        firstLabel="Criar primeira categoria"
        terms={terms.filter((term) => term.kind === 'category')}
        onCreate={createTerm}
        onUpdate={updateTerm}
        onDelete={deleteTerm}
      />
      <TaxonomySection
        kind="color"
        title="Cores"
        emptyTitle="Ainda não tens cores."
        emptyDescription="Cria as cores que fazem sentido para o teu negócio. A IA usará estas cores para organizar e encontrar os teus produtos."
        newLabel="Nova cor"
        firstLabel="Criar primeira cor"
        terms={terms.filter((term) => term.kind === 'color')}
        onCreate={createTerm}
        onUpdate={updateTerm}
        onDelete={deleteTerm}
      />
    </div>
  )
}

function TaxonomySection({
  kind,
  title,
  emptyTitle,
  emptyDescription,
  newLabel,
  firstLabel,
  terms,
  onCreate,
  onUpdate,
  onDelete,
}: {
  kind: 'category' | 'color'
  title: string
  emptyTitle: string
  emptyDescription: string
  newLabel: string
  firstLabel: string
  terms: TaxonomyTerm[]
  onCreate: (kind: 'category' | 'color', canonicalValue: string, aliases: string[]) => Promise<boolean>
  onUpdate: (id: string, patch: { canonical_value?: string; aliases?: string[]; enabled?: boolean }) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Tags className="h-4 w-4 text-primary" />
          {title}
        </h2>
        {!creating ? (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus />
            {newLabel}
          </Button>
        ) : null}
      </div>

      {creating ? (
        <NewTermForm
          kind={kind}
          onCancel={() => setCreating(false)}
          onCreate={async (value, aliases) => {
            const ok = await onCreate(kind, value, aliases)
            if (ok) setCreating(false)
          }}
        />
      ) : null}

      {terms.length === 0 && !creating ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="font-medium">{emptyTitle}</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">{emptyDescription}</p>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              {firstLabel}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {terms.map((term) => (
            <TermRow key={term.id} term={term} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}

function NewTermForm({
  kind,
  onCancel,
  onCreate,
}: {
  kind: 'category' | 'color'
  onCancel: () => void
  onCreate: (canonicalValue: string, aliases: string[]) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [aliases, setAliases] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!value.trim()) return
    setSaving(true)
    try {
      await onCreate(value.trim(), parseAliases(aliases))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input
              autoFocus
              required
              placeholder={kind === 'color' ? 'Ex.: Cor principal' : 'Ex.: Categoria principal'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Aliases (opcional)</Label>
            <Input
              placeholder="sinónimo 1, sinónimo 2"
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm" disabled={saving || !value.trim()}>
              {saving ? <Loader2 className="animate-spin" /> : <Plus />}
              Criar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function TermRow({
  term,
  onUpdate,
  onDelete,
}: {
  term: TaxonomyTerm
  onUpdate: (id: string, patch: { canonical_value?: string; aliases?: string[]; enabled?: boolean }) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(term.canonical_value)
  const [aliases, setAliases] = useState(term.aliases.join(', '))
  const [enabled, setEnabled] = useState(term.enabled)
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setValue(term.canonical_value)
    setAliases(term.aliases.join(', '))
    setEnabled(term.enabled)
    setEditing(true)
  }

  async function save() {
    if (!value.trim()) {
      toast.error('O nome é obrigatório.')
      return
    }
    setSaving(true)
    try {
      await onUpdate(term.id, { canonical_value: value.trim(), aliases: parseAliases(aliases), enabled })
      toast.success('Guardado.')
      setEditing(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    const warning =
      term.productCount > 0
        ? `${term.productCount} produto(s) usam actualmente "${term.canonical_value}". Remover na mesma?`
        : `Remover "${term.canonical_value}"?`
    if (!confirm(warning)) return
    await onDelete(term.id)
  }

  return (
    <CollapsibleEditor
      editing={editing}
      onToggle={() => (editing ? setEditing(false) : startEdit())}
      onCancel={() => setEditing(false)}
      onSave={save}
      saving={saving}
      header={
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{term.canonical_value}</span>
            {!term.enabled ? <Badge variant="outline">Inactiva</Badge> : null}
          </div>
          {term.aliases.length > 0 ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">Aliases: {term.aliases.join(', ')}</p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {term.productCount} produto{term.productCount === 1 ? '' : 's'}
          </p>
        </div>
      }
    >
      <div className="space-y-1.5">
        <Label>Nome</Label>
        <Input value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Aliases (separa por vírgulas)</Label>
        <Input value={aliases} onChange={(e) => setAliases(e.target.value)} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} id={`enabled-${term.id}`} />
          <Label htmlFor={`enabled-${term.id}`}>Activa</Label>
        </div>
        <Button size="sm" variant="destructive" onClick={() => void remove()} disabled={saving}>
          <Trash2 />
          Eliminar
        </Button>
      </div>
    </CollapsibleEditor>
  )
}
