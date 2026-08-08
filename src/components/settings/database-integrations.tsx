'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Database, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
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
  variantsTable: '',
  variantId: 'id',
  variantProductId: 'product_id',
  variantSize: 'size',
  variantColor: 'color',
  variantStock: 'stock_quantity',
  variantImageUrl: '',
  variantActiveColumn: '',
  catalogTable: '',
  catalogSearchColumns: '',
  catalogVariantsTable: '',
  catalogVariantId: 'id',
  catalogVariantProductId: 'product_id',
  catalogVariantSize: '',
  catalogVariantColor: '',
  catalogVariantImageUrl: '',
  catalogVariantActiveColumn: '',
  brandsTable: '',
  brandId: 'id',
  brandName: 'name',
}

type IntegrationForm = typeof initialForm

function mappingString(mapping: Record<string, unknown> | null, key: string, fallback = ''): string {
  const value = mapping?.[key]
  return typeof value === 'string' ? value : fallback
}

function mappingList(mapping: Record<string, unknown> | null, key: string, fallback = ''): string {
  const value = mapping?.[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').join(',')
    : mappingString(mapping, key, fallback)
}

function formFromSource(source: Source): IntegrationForm {
  const mapping = source.field_mapping
  return {
    ...initialForm,
    name: source.name,
    base_url: source.base_url ?? '',
    auth_secret: '',
    schema: mappingString(mapping, 'schema', 'public'),
    table: mappingString(mapping, 'table'),
    id: mappingString(mapping, 'id', 'id'),
    nameColumn: mappingString(mapping, 'name', 'name'),
    description: mappingString(mapping, 'description'),
    price: mappingString(mapping, 'price', 'price'),
    currency: mappingString(mapping, 'currency'),
    imageUrl: mappingString(mapping, 'imageUrl'),
    productUrl: mappingString(mapping, 'productUrl'),
    category: mappingString(mapping, 'category'),
    stockQuantity: mappingString(mapping, 'stockQuantity'),
    searchColumns: mappingList(mapping, 'searchColumns', 'name,description'),
    activeColumn: mappingString(mapping, 'activeColumn'),
    publishedColumn: mappingString(mapping, 'publishedColumn'),
    variantsTable: mappingString(mapping, 'variantsTable'),
    variantId: mappingString(mapping, 'variantId', 'id'),
    variantProductId: mappingString(mapping, 'variantProductId', 'product_id'),
    variantSize: mappingString(mapping, 'variantSize', 'size'),
    variantColor: mappingString(mapping, 'variantColor', 'color'),
    variantStock: mappingString(mapping, 'variantStock', 'stock_quantity'),
    variantImageUrl: mappingString(mapping, 'variantImageUrl'),
    variantActiveColumn: mappingString(mapping, 'variantActiveColumn'),
    catalogTable: mappingString(mapping, 'catalogTable'),
    catalogSearchColumns: mappingList(mapping, 'catalogSearchColumns'),
    catalogVariantsTable: mappingString(mapping, 'catalogVariantsTable'),
    catalogVariantId: mappingString(mapping, 'catalogVariantId', 'id'),
    catalogVariantProductId: mappingString(mapping, 'catalogVariantProductId', 'product_id'),
    catalogVariantSize: mappingString(mapping, 'catalogVariantSize'),
    catalogVariantColor: mappingString(mapping, 'catalogVariantColor'),
    catalogVariantImageUrl: mappingString(mapping, 'catalogVariantImageUrl'),
    catalogVariantActiveColumn: mappingString(mapping, 'catalogVariantActiveColumn'),
    brandsTable: mappingString(mapping, 'brandsTable'),
    brandId: mappingString(mapping, 'brandId', 'id'),
    brandName: mappingString(mapping, 'brandName', 'name'),
  }
}

export function DatabaseIntegrations() {
  const [sources, setSources] = useState<Source[]>([])
  const [form, setForm] = useState<IntegrationForm>(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
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
      variantsTable: form.variantsTable.trim() || undefined,
      variantId: form.variantId.trim() || undefined,
      variantProductId: form.variantProductId.trim() || undefined,
      variantSize: form.variantSize.trim() || undefined,
      variantColor: form.variantColor.trim() || undefined,
      variantStock: form.variantStock.trim() || undefined,
      variantImageUrl: form.variantImageUrl.trim() || undefined,
      variantActiveColumn: form.variantActiveColumn.trim() || undefined,
      catalogTable: form.catalogTable.trim() || undefined,
      catalogSearchColumns: form.catalogSearchColumns.split(',').map((value) => value.trim()).filter(Boolean),
      catalogVariantsTable: form.catalogVariantsTable.trim() || undefined,
      catalogVariantId: form.catalogVariantId.trim() || undefined,
      catalogVariantProductId: form.catalogVariantProductId.trim() || undefined,
      catalogVariantSize: form.catalogVariantSize.trim() || undefined,
      catalogVariantColor: form.catalogVariantColor.trim() || undefined,
      catalogVariantImageUrl: form.catalogVariantImageUrl.trim() || undefined,
      catalogVariantActiveColumn: form.catalogVariantActiveColumn.trim() || undefined,
      brandsTable: form.brandsTable.trim() || undefined,
      brandId: form.brandId.trim() || undefined,
      brandName: form.brandName.trim() || undefined,
    }
  }

  function startEdit(source: Source) {
    setEditingId(source.id)
    setForm(formFromSource(source))
    setPreview([])
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(initialForm)
    setPreview([])
  }

  async function testConnection() {
    if (editingId && !form.auth_secret.trim()) {
      toast.info('Para testar durante a edição, introduza novamente a API key. Se apenas guardar, a chave actual será mantida.')
      return
    }
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
      const extra = body.tables_checked ? ` · ${body.tables_checked} tabela(s) verificada(s)` : ''
      toast.success(`Ligação estabelecida: ${body.raw_item_count ?? 0} registo(s) lido(s)${extra}.`)
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
      const editing = Boolean(editingId)
      const payload: Record<string, unknown> = {
        name: form.name,
        base_url: form.base_url,
        field_mapping: fieldMapping(),
      }
      if (!editing) payload.source_type = 'external_supabase'
      if (!editing || form.auth_secret.trim()) payload.auth_secret = form.auth_secret

      const response = await fetch(editing ? `/api/catalog/sources/${editingId}` : '/api/catalog/sources', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? (editing ? 'Não foi possível actualizar a integração.' : 'Não foi possível guardar a integração.'))

      if (editing) {
        setSources((current) => current.map((source) => source.id === editingId ? body.source : source))
        toast.success('Integração actualizada.')
      } else {
        setSources((current) => [body.source, ...current])
        toast.success('Base de dados ligada ao WA CRM.')
      }
      setEditingId(null)
      setForm(initialForm)
      setPreview([])
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
      if (editingId === id) cancelEdit()
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
            <CardTitle>{editingId ? 'Editar base de dados externa' : 'Base de dados externa'}</CardTitle>
          </div>
          <CardDescription>
            {editingId
              ? 'Altere a ligação ou o mapeamento. Deixe a API key vazia para manter a chave já guardada.'
              : 'Liga uma base Supabase externa em modo de leitura. Pode combinar stock, variações e produtos apenas de catálogo na mesma integração.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label>Nome da integração</Label><Input required placeholder="Base LC Fitness" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-2"><Label>Tipo</Label><Input value="Supabase (leitura)" disabled /></div>
            <div className="space-y-2 md:col-span-2"><Label>URL do Supabase</Label><Input required type="url" placeholder="https://supabase.exemplo.com" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} /></div>
            <div className="space-y-2 md:col-span-2"><Label>API key de leitura</Label><Input required={!editingId} type="password" autoComplete="new-password" placeholder={editingId ? 'Deixe vazio para manter a chave actual' : 'anon key ou chave dedicada read-only'} value={form.auth_secret} onChange={(e) => setForm({ ...form, auth_secret: e.target.value })} /><p className="text-xs text-muted-foreground">{editingId ? 'A chave guardada nunca é mostrada. Preencha este campo apenas se quiser substituí-la.' : 'Evite a service_role. Prefira uma chave/role com acesso apenas aos dados que o agente pode consultar.'}</p></div>
            <div className="space-y-2"><Label>Schema</Label><Input required value={form.schema} onChange={(e) => setForm({ ...form, schema: e.target.value })} /></div>
            <div className="space-y-2"><Label>Tabela principal de produtos/stock</Label><Input required placeholder="stock_products" value={form.table} onChange={(e) => setForm({ ...form, table: e.target.value })} /></div>

            <div className="space-y-2 md:col-span-2"><p className="text-sm font-medium">Mapeamento da tabela principal</p><p className="text-xs text-muted-foreground">Esta tabela continua a ser a fonte autoritativa para o stock.</p></div>
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

            <div className="space-y-2 md:col-span-2"><p className="text-sm font-medium">Variações de stock (opcional)</p><p className="text-xs text-muted-foreground">Para a LC Fitness, use <code>stock_variations</code>. A pesquisa associa tamanho, cor e stock a cada produto.</p></div>
            <div className="space-y-2"><Label>Tabela de variações</Label><Input placeholder="stock_variations" value={form.variantsTable} onChange={(e) => setForm({ ...form, variantsTable: e.target.value })} /></div>
            <div className="space-y-2"><Label>FK para produto</Label><Input placeholder="product_id" value={form.variantProductId} onChange={(e) => setForm({ ...form, variantProductId: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna ID da variação</Label><Input value={form.variantId} onChange={(e) => setForm({ ...form, variantId: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna tamanho</Label><Input value={form.variantSize} onChange={(e) => setForm({ ...form, variantSize: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna cor</Label><Input value={form.variantColor} onChange={(e) => setForm({ ...form, variantColor: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna stock da variação</Label><Input value={form.variantStock} onChange={(e) => setForm({ ...form, variantStock: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna imagem da variação</Label><Input placeholder="image_url" value={form.variantImageUrl} onChange={(e) => setForm({ ...form, variantImageUrl: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna activo da variação</Label><Input placeholder="is_active" value={form.variantActiveColumn} onChange={(e) => setForm({ ...form, variantActiveColumn: e.target.value })} /></div>

            <div className="space-y-2 md:col-span-2"><p className="text-sm font-medium">Produtos apenas de catálogo (opcional)</p><p className="text-xs text-muted-foreground">Na LC Fitness, <code>products</code> e <code>product_variants</code> podem enriquecer a pesquisa e fornecer fotografias sem interferir no stock. O stock continua a vir exclusivamente das tabelas de stock.</p></div>
            <div className="space-y-2"><Label>Tabela de catálogo</Label><Input placeholder="products" value={form.catalogTable} onChange={(e) => setForm({ ...form, catalogTable: e.target.value })} /></div>
            <div className="space-y-2"><Label>Colunas de pesquisa do catálogo</Label><Input placeholder="vazio = detecção tolerante" value={form.catalogSearchColumns} onChange={(e) => setForm({ ...form, catalogSearchColumns: e.target.value })} /></div>
            <div className="space-y-2"><Label>Tabela de variações do catálogo</Label><Input placeholder="product_variants" value={form.catalogVariantsTable} onChange={(e) => setForm({ ...form, catalogVariantsTable: e.target.value })} /></div>
            <div className="space-y-2"><Label>FK da variação para produto</Label><Input placeholder="product_id" value={form.catalogVariantProductId} onChange={(e) => setForm({ ...form, catalogVariantProductId: e.target.value })} /></div>
            <div className="space-y-2"><Label>ID da variação de catálogo</Label><Input value={form.catalogVariantId} onChange={(e) => setForm({ ...form, catalogVariantId: e.target.value })} /></div>
            <div className="space-y-2"><Label>Tamanho da variação de catálogo</Label><Input placeholder="size (opcional)" value={form.catalogVariantSize} onChange={(e) => setForm({ ...form, catalogVariantSize: e.target.value })} /></div>
            <div className="space-y-2"><Label>Cor da variação de catálogo</Label><Input placeholder="color (opcional)" value={form.catalogVariantColor} onChange={(e) => setForm({ ...form, catalogVariantColor: e.target.value })} /></div>
            <div className="space-y-2"><Label>Imagem da variação de catálogo</Label><Input placeholder="image_url (vazio = detecção automática)" value={form.catalogVariantImageUrl} onChange={(e) => setForm({ ...form, catalogVariantImageUrl: e.target.value })} /></div>
            <div className="space-y-2"><Label>Activo da variação de catálogo</Label><Input placeholder="is_active (opcional)" value={form.catalogVariantActiveColumn} onChange={(e) => setForm({ ...form, catalogVariantActiveColumn: e.target.value })} /></div>

            <div className="space-y-2 md:col-span-2"><p className="text-sm font-medium">Marcas (opcional)</p><p className="text-xs text-muted-foreground"><code>store_brands</code> pode ficar registada na mesma integração para enriquecimento futuro, sem interferir no controlo de stock.</p></div>
            <div className="space-y-2"><Label>Tabela de marcas</Label><Input placeholder="store_brands" value={form.brandsTable} onChange={(e) => setForm({ ...form, brandsTable: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna nome da marca</Label><Input value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })} /></div>
            <div className="space-y-2"><Label>Coluna ID da marca</Label><Input value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })} /></div>

            <div className="flex flex-wrap gap-2 md:col-span-2"><Button type="button" variant="outline" onClick={() => void testConnection()} disabled={testing}>{testing ? <Loader2 className="animate-spin" /> : <RefreshCw />}Testar ligação</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : editingId ? <Pencil /> : <Plus />}{editingId ? 'Guardar alterações' : 'Guardar integração'}</Button>{editingId ? <Button type="button" variant="ghost" onClick={cancelEdit}><X />Cancelar</Button> : null}</div>
          </form>
          {preview.length > 0 ? <div className="mt-5 space-y-2"><p className="font-medium">Pré-visualização</p>{preview.map((product) => <div key={product.id} className="rounded-lg border p-3"><p className="font-medium">{product.name}</p><p className="text-sm text-muted-foreground">{product.price} {product.currency}</p></div>)}</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Integrações ligadas</CardTitle><CardDescription>Somente as fontes de base de dados desta organização.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-muted-foreground">A carregar...</p> : databaseSources.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma base de dados ligada.</p> : databaseSources.map((source) => <div key={source.id} className={`flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${editingId === source.id ? 'ring-1 ring-primary' : ''}`}><div><p className="font-medium">{source.name}</p><p className="text-xs text-muted-foreground">{source.base_url} · {String(source.field_mapping?.schema ?? 'public')}.{String(source.field_mapping?.table ?? '')}{source.field_mapping?.catalogTable ? ` + ${String(source.field_mapping.catalogTable)}` : ''}{source.field_mapping?.catalogVariantsTable ? ` + ${String(source.field_mapping.catalogVariantsTable)}` : ''}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => startEdit(source)}><Pencil />Editar</Button><Button size="sm" variant="outline" onClick={() => void toggle(source)}>{source.is_active ? 'Desactivar' : 'Activar'}</Button><Button size="sm" variant="destructive" onClick={() => void remove(source.id)}><Trash2 />Remover</Button></div></div>)}
        </CardContent>
      </Card>
    </div>
  )
}
