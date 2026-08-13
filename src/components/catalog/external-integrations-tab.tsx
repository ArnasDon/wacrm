'use client'

import { FormEvent, useState } from 'react'
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DatabaseIntegrations } from '@/components/settings/database-integrations'

export interface Source {
  id: string
  name: string
  source_type: string
  base_url: string | null
  search_path: string | null
  auth_type: string
  is_active: boolean
}

const initialSource = {
  name: '',
  base_url: '',
  search_path: 'products?search={query}&limit={limit}',
  auth_type: 'none',
  auth_header: 'X-API-Key',
  auth_secret: '',
  field_mapping: JSON.stringify(
    {
      items: 'data.products',
      id: 'id',
      name: 'name',
      description: 'description',
      price: 'price',
      currency: 'currency',
      imageUrl: 'images.0.url',
      productUrl: 'url',
      category: 'category.name',
      stockQuantity: 'stock',
    },
    null,
    2,
  ),
}

function BetaBadge() {
  return (
    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-300">
      Beta
    </span>
  )
}

/**
 * External catalogue integrations (REST API + external Supabase) —
 * deliberately kept out of the main Produtos flow. A new account never
 * needs this to get the agent working: the internal catalogue is
 * enough on its own. This area stays available and fully functional
 * for accounts that already depend on it, just clearly marked as
 * secondary/beta rather than the default path.
 */
export function ExternalIntegrationsTab({ sources, setSources }: { sources: Source[]; setSources: (updater: (current: Source[]) => Source[]) => void }) {
  const [sourceForm, setSourceForm] = useState(initialSource)
  const [savingSource, setSavingSource] = useState(false)
  const [testing, setTesting] = useState(false)
  const [preview, setPreview] = useState<Array<{ id: string; name: string; price: number; currency: string; imageUrl?: string | null }>>([])

  const apiSources = sources.filter((source) => source.source_type === 'external_rest')

  function mapping() {
    try {
      return JSON.parse(sourceForm.field_mapping) as Record<string, unknown>
    } catch {
      throw new Error('O mapeamento deve ser JSON válido.')
    }
  }

  async function testSource() {
    setTesting(true)
    try {
      const r = await fetch('/api/catalog/sources/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sourceForm, source_type: 'external_rest', field_mapping: mapping(), query: 'produto' }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(b.error ?? 'Falha no teste.')
      setPreview(b.products ?? [])
      toast.success(`Ligação válida: ${b.products?.length ?? 0} produto(s) reconhecido(s).`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha no teste.')
    } finally {
      setTesting(false)
    }
  }

  async function submitSource(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSavingSource(true)
    try {
      const r = await fetch('/api/catalog/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sourceForm, source_type: 'external_rest', field_mapping: mapping() }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(b.error ?? 'Não foi possível ligar a API.')
      setSources((current) => [b.source, ...current])
      setSourceForm(initialSource)
      setPreview([])
      toast.success('Fonte externa ligada.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao ligar a API.')
    } finally {
      setSavingSource(false)
    }
  }

  async function removeSource(id: string) {
    if (!confirm('Remover esta fonte externa?')) return
    const r = await fetch(`/api/catalog/sources/${id}`, { method: 'DELETE' })
    if (r.ok) {
      setSources((current) => current.filter((s) => s.id !== id))
      toast.success('Fonte removida.')
    } else {
      toast.error('Não foi possível remover a fonte.')
    }
  }

  async function toggleSource(s: Source) {
    const r = await fetch(`/api/catalog/sources/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !s.is_active }),
    })
    const b = await r.json().catch(() => ({}))
    if (r.ok) setSources((current) => current.map((x) => (x.id === s.id ? b.source : x)))
    else toast.error(b.error ?? 'Não foi possível actualizar a fonte.')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Integrações externas</h2>
        <BetaBadge />
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Liga uma API ou base de dados externa se já geres o teu catálogo noutro sistema. Isto é opcional — o catálogo
        interno funciona sozinho, sem precisares de nada aqui.
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Ligar API de catálogo</CardTitle>
            <CardDescription>Teste antes de guardar.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitSource} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input required value={sourceForm.name} onChange={(e) => setSourceForm({ ...sourceForm, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>URL base HTTPS</Label>
                <Input type="url" required value={sourceForm.base_url} onChange={(e) => setSourceForm({ ...sourceForm, base_url: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Caminho</Label>
                <Input value={sourceForm.search_path} onChange={(e) => setSourceForm({ ...sourceForm, search_path: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Autenticação</Label>
                <select
                  className="h-8 w-full rounded-lg border bg-background px-2.5"
                  value={sourceForm.auth_type}
                  onChange={(e) => setSourceForm({ ...sourceForm, auth_type: e.target.value })}
                >
                  <option value="none">Sem autenticação</option>
                  <option value="bearer">Bearer token</option>
                  <option value="api_key_header">Chave no cabeçalho</option>
                </select>
              </div>
              {sourceForm.auth_type === 'api_key_header' ? (
                <Input placeholder="Nome do cabeçalho" value={sourceForm.auth_header} onChange={(e) => setSourceForm({ ...sourceForm, auth_header: e.target.value })} />
              ) : null}
              {sourceForm.auth_type !== 'none' ? (
                <Input type="password" placeholder="Token ou chave" value={sourceForm.auth_secret} onChange={(e) => setSourceForm({ ...sourceForm, auth_secret: e.target.value })} />
              ) : null}
              <div className="space-y-2">
                <Label>Mapeamento JSON</Label>
                <Textarea className="min-h-72 font-mono text-xs" value={sourceForm.field_mapping} onChange={(e) => setSourceForm({ ...sourceForm, field_mapping: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => void testSource()} disabled={testing}>
                  {testing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Testar
                </Button>
                <Button type="submit" disabled={savingSource}>
                  {savingSource ? <Loader2 className="animate-spin" /> : <Plus />}
                  Guardar
                </Button>
              </div>
            </form>
            {preview.length ? (
              <div className="mt-5 space-y-2">
                <p className="font-medium">Pré-visualização</p>
                {preview.map((x) => (
                  <div key={x.id} className="flex items-center gap-3 rounded-lg border p-2">
                    {x.imageUrl ? <img src={x.imageUrl} alt="" className="h-12 w-12 rounded object-cover" /> : null}
                    <div>
                      <p className="font-medium">{x.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {x.price} {x.currency}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>APIs ligadas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {apiSources.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma API externa.</p>
            ) : (
              apiSources.map((s) => (
                <div key={s.id} className="rounded-lg border p-3">
                  <p className="font-medium">{s.name}</p>
                  <p className="break-all text-xs text-muted-foreground">{s.base_url}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void toggleSource(s)}>
                      {s.is_active ? 'Desactivar' : 'Activar'}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => void removeSource(s.id)}>
                      <Trash2 />
                      Remover
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <DatabaseIntegrations />
    </div>
  )
}
