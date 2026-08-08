'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Database, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Source = {
  id: string
  name: string
  source_type: string
  is_active: boolean
  base_url: string | null
  field_mapping: Record<string, unknown> | null
}

const initialForm = {
  name: '',
  base_url: '',
  auth_secret: '',
  schema: 'public',
  table: '',
  id: 'id',
  nameColumn: 'name',
  description: 'description',
  price: 'price',
  currency: 'currency',
  imageUrl: 'image_url',
  productUrl: 'product_url',
  category: 'category',
  stockQuantity: 'stock_quantity',
  searchColumns: 'name,description',
  activeColumn: '',
  publishedColumn: '',
}

export function DatabaseIntegrations() {
  const [sources, setSources] = useState<Source[]>([])
  const [form, setForm] = useState(initialForm)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<Array<{ id: string; name: string; price: number; currency: string; imageUrl?: string | null }>>([])

  const databaseSources = useMemo(
    () => sources.filter((source) => source.source_type === 'external_supabase'),
    [sources],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/catalog/sources', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível carregar as integrações.')
      setSources(body.sources ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao carregar integrações.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function fieldMapping() {
    return {
      schema: form.schema.trim() || 'public',
      table: form.table.trim(),
      id: form.id.trim() || 'id',
      name: form.nameColumn.trim() || 'name',
      description: form.description.trim() || undefined,
      price: form.price.trim() || 'price',
      currency: form.currency.trim() || undefined,
      imageUrl: form.imageUrl.trim() || undefined,
      productUrl: form.productUrl.trim() || undefined,
      category: form.category.trim() || undefined,
      stockQuantity: form.stockQuantity.trim() || undefined,
      searchColumns: form.searchColumns.split(',').map((value) => value.trim()).filter(Boolean),
      activeColumn: form.activeColumn.trim() || undefined,
      publishedColumn: form.publishedColumn.trim() || undefined,
    }
  }

  async function testConnection() {
    setTesting(true)
    try {
      const response = await fetch('/api/catalog/sources/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: 'external_supabase',
          name: form.name,
          base_url: form.base_url,
          auth_secret: form.auth_secret,
          field_mapping: fieldMapping(),
          query: '',
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Falha no teste de ligação.')
      setPreview(body.products ?? [])
      toast.success(`Ligação estabelecida: ${body.raw_item_count ?? 0} registo(s) lido(s).`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha no teste de ligação.')
    } finally {
      setTesting(false)
    }
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    try {
      const response = await fetch('/api/catalog/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: 'external_supabase',
          name: form.name,
          base_url: form.base_url,
          auth_secret: form.auth_secret,
          field_mapping: fieldMapping(),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível guardar a integração.')
      setSources((current) => [body.source, ...current])
      setForm(initialForm)
      setPreview([])
      toast.success('Base de dados ligada ao WA CRM.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao guardar integração.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Remover esta integração?')) return
    const response = await fetch(`/api/catalog/sources/${id}`, { method: 'DELETE' })
    if (response.ok) {
      setSources((current) => current.filter((source) => source.id !== id))
      toast.success('Integração removida.')
    } else {
      toast.error('Não foi possível remover a integração.')
    }
  }

  async function toggle(source: Source) {
    const response = await fetch(`/api/catalog/sources/${source.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !source.is_active }),
    })
    const body = await response.json().catch(() => ({}))
    if (response.ok) {
      setSources((current) => current.map((item) => item.id === source.id ? body.source : item))
    } else {
      toast.error(body.error ?? 'Não foi possível actualizar a integração.')
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            <CardTitle>Base de dados externa</CardTitle>
          </div>
          <CardDescription>
            Liga uma base Supabase externa em modo de leitura. As credenciais ficam cifradas no backend e nunca são entregues ao agente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label>Nome da integração</Label><Input required placeholder="Base LC Fitness" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-2"><Label>Tipo</Label><Input value="Supabase (leitura)" disabled /></div>
            <div className="space-y-2 md:col-span-2"><Label>URL do Supabase</Label><Input required type="url" placeholder="https://supabase.exemplo.com" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} /></div>
            <div className="space-y-2 md:col-span-2"><Label>API key de leitura</Label><Input required type="password" autoComplete="new-password" placeholder="anon key ou chave dedicada read-only" value={form.auth_secret} onChange={(e) => setForm({ ...form, auth_secret: e.target.value })} /><p className="text-xs text-muted-foreground">Evite a service_role. Prefira uma chave/role com acesso apenas aos dados que o agente pode consultar.</p></div>
            <div className="space-y-2"><Label>Schema</Label><Input required value={form.schema} onChange={(e) => setForm({ ...form, schema: e.target.value })} /></div>
            <div className="space-y-2"><Label>Tabela ou view de produtos</Label><Input required placeholder="stock_products_v2" value={form.table} onChange={(e) => setForm({ ...form, table: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna ID</Label><Input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna nome</Label><Input value={form.nameColumn} onChange={(e) => setForm({ ...form, nameColumn: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna preço</Label><Input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna stock</Label><Input value={form.stockQuantity} onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna descrição</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna categoria</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna imagem</Label><Input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna URL do produto</Label><Input value={form.productUrl} onChange={(e) => setForm({ ...form, productUrl: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna moeda</Label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></div>
            <div className="space-y-2"><Label>Colunas de pesquisa</Label><Input placeholder="name,description" value={form.searchColumns} onChange={(e) => setForm({ ...form, searchColumns: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna activo (opcional)</Label><Input placeholder="is_active" value={form.activeColumn} onChange={(e) => setForm({ ...form, activeColumn: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna publicado (opcional)</Label><Input placeholder="is_published" value={form.publishedColumn} onChange={(e) => setForm({ ...form, publishedColumn: e.target.value })} /></div>
            <div className="flex gap-2 md:col-span-2"><Button type="button" variant="outline" onClick={() => void testConnection()} disabled={testing}>{testing ? <Loader2 className="animate-spin" /> : <RefreshCw />}Testar ligação</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Plus />}Guardar integração</Button></div>
          </form>
          {preview.length > 0 ? <div className="mt-5 space-y-2"><p className="font-medium">Pré-visualização</p>{preview.map((product) => <div key={product.id} className="rounded-lg border p-3"><p className="font-medium">{product.name}</p><p className="text-sm text-muted-foreground">{product.price} {product.currency}</p></div>)}</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Integrações ligadas</CardTitle><CardDescription>Somente as fontes de base de dados desta organização.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-muted-foreground">A carregar...</p> : databaseSources.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma base de dados ligada.</p> : databaseSources.map((source) => <div key={source.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{source.name}</p><p className="text-xs text-muted-foreground">{source.base_url} · {String(source.field_mapping?.schema ?? 'public')}.{String(source.field_mapping?.table ?? '')}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void toggle(source)}>{source.is_active ? 'Desactivar' : 'Activar'}</Button><Button size="sm" variant="destructive" onClick={() => void remove(source.id)}><Trash2 />Remover</Button></div></div>)}
        </CardContent>
      </Card>
    </div>
  )
}
