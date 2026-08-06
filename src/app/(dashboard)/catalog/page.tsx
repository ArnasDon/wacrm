'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, ImageIcon, Loader2, PackageSearch, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

type Product = {
  id: string
  name: string
  description: string | null
  price: number | string
  currency: string
  image_url: string | null
  product_url: string | null
  category: string | null
  stock_quantity: number | null
  is_active: boolean
}

type Source = {
  id: string
  name: string
  base_url: string | null
  search_path: string | null
  auth_type: string
  is_active: boolean
}

const initialProduct = {
  name: '',
  price: '',
  currency: 'MZN',
  image_url: '',
  description: '',
  category: '',
  product_url: '',
  stock_quantity: '',
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

export default function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [savingProduct, setSavingProduct] = useState(false)
  const [savingSource, setSavingSource] = useState(false)
  const [productForm, setProductForm] = useState(initialProduct)
  const [sourceForm, setSourceForm] = useState(initialSource)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [productsRes, sourcesRes] = await Promise.all([
        fetch('/api/catalog/products', { cache: 'no-store' }),
        fetch('/api/catalog/sources', { cache: 'no-store' }),
      ])
      const productsBody = await productsRes.json().catch(() => ({}))
      const sourcesBody = await sourcesRes.json().catch(() => ({}))
      if (!productsRes.ok) throw new Error(productsBody.error ?? 'Não foi possível carregar os produtos.')
      if (!sourcesRes.ok && sourcesRes.status !== 403) {
        throw new Error(sourcesBody.error ?? 'Não foi possível carregar as fontes externas.')
      }
      setProducts(productsBody.products ?? [])
      setSources(sourcesBody.sources ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao carregar o catálogo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const activeProducts = useMemo(() => products.filter((item) => item.is_active), [products])

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingProduct(true)
    try {
      const response = await fetch('/api/catalog/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productForm),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível criar o produto.')
      setProducts((current) => [body.product, ...current])
      setProductForm(initialProduct)
      toast.success('Produto adicionado ao catálogo.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar o produto.')
    } finally {
      setSavingProduct(false)
    }
  }

  async function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingSource(true)
    try {
      let mapping: Record<string, unknown>
      try {
        mapping = JSON.parse(sourceForm.field_mapping)
      } catch {
        throw new Error('O mapeamento dos campos deve ser JSON válido.')
      }

      const response = await fetch('/api/catalog/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sourceForm, field_mapping: mapping }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível ligar a API.')
      setSources((current) => [body.source, ...current])
      setSourceForm(initialSource)
      toast.success('Fonte externa ligada ao catálogo.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao ligar a API.')
    } finally {
      setSavingSource(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <PackageSearch className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Catálogo</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie produtos rapidamente ou ligue uma API externa. O agente usa os mesmos dados para responder no WhatsApp.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadData()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Actualizar
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card size="sm"><CardHeader><CardDescription>Produtos activos</CardDescription><CardTitle>{activeProducts.length}</CardTitle></CardHeader></Card>
        <Card size="sm"><CardHeader><CardDescription>Fontes externas</CardDescription><CardTitle>{sources.length}</CardTitle></CardHeader></Card>
        <Card size="sm"><CardHeader><CardDescription>Origem dos dados</CardDescription><CardTitle>Interna + APIs</CardTitle></CardHeader></Card>
      </div>

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Produtos</TabsTrigger>
          <TabsTrigger value="external">API externa</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Adicionar produto rápido</CardTitle>
              <CardDescription>Nome e preço são obrigatórios. A fotografia pode ser uma ligação pública.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitProduct} className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="product-name">Nome</Label><Input id="product-name" required value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} /></div>
                <div className="grid grid-cols-[1fr_90px] gap-2"><div className="space-y-2"><Label htmlFor="product-price">Preço</Label><Input id="product-price" type="number" min="0" step="0.01" required value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} /></div><div className="space-y-2"><Label htmlFor="product-currency">Moeda</Label><Input id="product-currency" maxLength={8} value={productForm.currency} onChange={(e) => setProductForm({ ...productForm, currency: e.target.value.toUpperCase() })} /></div></div>
                <div className="space-y-2 md:col-span-2"><Label htmlFor="product-image">URL da fotografia</Label><Input id="product-image" type="url" placeholder="https://..." value={productForm.image_url} onChange={(e) => setProductForm({ ...productForm, image_url: e.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="product-category">Categoria</Label><Input id="product-category" value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="product-stock">Stock</Label><Input id="product-stock" type="number" min="0" value={productForm.stock_quantity} onChange={(e) => setProductForm({ ...productForm, stock_quantity: e.target.value })} /></div>
                <div className="space-y-2 md:col-span-2"><Label htmlFor="product-url">Página do produto</Label><Input id="product-url" type="url" placeholder="https://..." value={productForm.product_url} onChange={(e) => setProductForm({ ...productForm, product_url: e.target.value })} /></div>
                <div className="space-y-2 md:col-span-2"><Label htmlFor="product-description">Descrição</Label><Textarea id="product-description" value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} /></div>
                <div className="md:col-span-2"><Button type="submit" disabled={savingProduct}>{savingProduct ? <Loader2 className="animate-spin" /> : <Plus />}Adicionar produto</Button></div>
              </form>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {loading ? (
              <Card className="sm:col-span-2 xl:col-span-3"><CardContent className="flex items-center justify-center gap-2 py-10 text-muted-foreground"><Loader2 className="animate-spin" />A carregar produtos...</CardContent></Card>
            ) : products.length === 0 ? (
              <Card className="sm:col-span-2 xl:col-span-3"><CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground"><ImageIcon className="h-8 w-8" /><p>Ainda não existem produtos.</p></CardContent></Card>
            ) : products.map((product) => (
              <Card key={product.id} className={!product.is_active ? 'opacity-60' : ''}>
                {product.image_url ? <img src={product.image_url} alt={product.name} className="aspect-[4/3] w-full object-cover" /> : <div className="flex aspect-[4/3] items-center justify-center bg-muted"><ImageIcon className="h-10 w-10 text-muted-foreground" /></div>}
                <CardHeader>
                  <CardTitle>{product.name}</CardTitle>
                  <CardDescription>{product.category || 'Sem categoria'}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-lg font-semibold">{Number(product.price).toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} {product.currency}</p>
                  {product.description ? <p className="line-clamp-3 text-sm text-muted-foreground">{product.description}</p> : null}
                  <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{product.stock_quantity == null ? 'Stock não indicado' : `Stock: ${product.stock_quantity}`}</span>{product.product_url ? <a href={product.product_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Abrir <ExternalLink className="h-3 w-3" /></a> : null}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="external" className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader><CardTitle>Ligar API de qualquer catálogo</CardTitle><CardDescription>Defina o endereço, autenticação e a correspondência dos campos devolvidos.</CardDescription></CardHeader>
            <CardContent>
              <form onSubmit={submitSource} className="space-y-4">
                <div className="space-y-2"><Label htmlFor="source-name">Nome da fonte</Label><Input id="source-name" required placeholder="Catálogo da loja" value={sourceForm.name} onChange={(e) => setSourceForm({ ...sourceForm, name: e.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="source-url">URL base HTTPS</Label><Input id="source-url" type="url" required placeholder="https://loja.co.mz/api/" value={sourceForm.base_url} onChange={(e) => setSourceForm({ ...sourceForm, base_url: e.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="source-path">Caminho da pesquisa</Label><Input id="source-path" value={sourceForm.search_path} onChange={(e) => setSourceForm({ ...sourceForm, search_path: e.target.value })} /><p className="text-xs text-muted-foreground">Use {'{query}'} e {'{limit}'} como variáveis.</p></div>
                <div className="space-y-2"><Label htmlFor="source-auth">Autenticação</Label><select id="source-auth" className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm" value={sourceForm.auth_type} onChange={(e) => setSourceForm({ ...sourceForm, auth_type: e.target.value })}><option value="none">Sem autenticação</option><option value="bearer">Bearer token</option><option value="api_key_header">Chave num cabeçalho</option></select></div>
                {sourceForm.auth_type === 'api_key_header' ? <div className="space-y-2"><Label htmlFor="source-header">Nome do cabeçalho</Label><Input id="source-header" value={sourceForm.auth_header} onChange={(e) => setSourceForm({ ...sourceForm, auth_header: e.target.value })} /></div> : null}
                {sourceForm.auth_type !== 'none' ? <div className="space-y-2"><Label htmlFor="source-secret">Token ou chave</Label><Input id="source-secret" type="password" required value={sourceForm.auth_secret} onChange={(e) => setSourceForm({ ...sourceForm, auth_secret: e.target.value })} /></div> : null}
                <div className="space-y-2"><Label htmlFor="source-mapping">Mapeamento JSON</Label><Textarea id="source-mapping" className="min-h-72 font-mono text-xs" value={sourceForm.field_mapping} onChange={(e) => setSourceForm({ ...sourceForm, field_mapping: e.target.value })} /></div>
                <Button type="submit" disabled={savingSource}>{savingSource ? <Loader2 className="animate-spin" /> : <Plus />}Ligar API</Button>
              </form>
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader><CardTitle>Fontes ligadas</CardTitle><CardDescription>O agente pesquisa todas as fontes activas.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {sources.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma API externa ligada.</p> : sources.map((source) => <div key={source.id} className="rounded-lg border border-border p-3"><div className="flex items-center justify-between gap-2"><p className="font-medium">{source.name}</p><span className={`rounded-full px-2 py-0.5 text-xs ${source.is_active ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>{source.is_active ? 'Activa' : 'Inactiva'}</span></div><p className="mt-1 break-all text-xs text-muted-foreground">{source.base_url}{source.search_path}</p><p className="mt-2 text-xs text-muted-foreground">Autenticação: {source.auth_type}</p></div>)}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
