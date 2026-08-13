'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Sparkles, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { AttributeOption } from './attribute-select'
import { BulkItemCard, isBulkItemComplete, type BulkItem } from './bulk-item-card'
import { BulkUploadDropzone } from './bulk-upload-dropzone'
import { ProductCard, type Product } from './product-card'
import { ReclassifyDialog, type ReclassifyMode, type ReclassifyProgress, type ReclassifyResult } from './reclassify-dialog'

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

interface TaxonomyTerm {
  kind: 'category' | 'color'
  canonical_value: string
}

export function ProductsTab({ products, setProducts }: { products: Product[]; setProducts: (updater: (current: Product[]) => Product[]) => void }) {
  const [productForm, setProductForm] = useState(initialProduct)
  const [savingProduct, setSavingProduct] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([])
  const [bulkSaving, setBulkSaving] = useState(false)
  const [terms, setTerms] = useState<TaxonomyTerm[]>([])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [mode, setMode] = useState<ReclassifyMode>('fill_empty')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ReclassifyProgress | null>(null)
  const [result, setResult] = useState<ReclassifyResult | null>(null)

  const loadTerms = useCallback(async () => {
    try {
      const response = await fetch('/api/catalog/taxonomy', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (response.ok) setTerms(body.terms ?? [])
    } catch {
      // Non-fatal: the pickers just fall back to free "+ Criar" only.
    }
  }, [])
  useEffect(() => {
    void loadTerms()
  }, [loadTerms])

  const categoryOptions: AttributeOption[] = terms
    .filter((t) => t.kind === 'category')
    .map((t) => ({ value: t.canonical_value, label: t.canonical_value }))
  const colorOptions: AttributeOption[] = terms
    .filter((t) => t.kind === 'color')
    .map((t) => ({ value: t.canonical_value, label: t.canonical_value }))

  async function createTerm(kind: 'category' | 'color', label: string): Promise<string | null> {
    try {
      const response = await fetch('/api/catalog/taxonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, canonical_value: label }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível criar.')
      setTerms((current) => [...current, { kind, canonical_value: body.term.canonical_value }])
      return body.term.canonical_value as string
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar.')
      return null
    }
  }

  async function uploadImage(file: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await fetch('/api/catalog/upload', { method: 'POST', body: form })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(b.error ?? 'Falha no carregamento.')
      setProductForm((f) => ({ ...f, image_url: b.url }))
      toast.success('Fotografia carregada.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro no carregamento.')
    } finally {
      setUploading(false)
    }
  }

  async function submitProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSavingProduct(true)
    try {
      const r = await fetch('/api/catalog/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productForm),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(b.error ?? 'Não foi possível criar o produto.')
      setProducts((current) => [b.product, ...current])
      setProductForm(initialProduct)
      toast.success('Produto adicionado.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar produto.')
    } finally {
      setSavingProduct(false)
    }
  }

  async function removeProduct(id: string) {
    if (!confirm('Remover este produto?')) return
    const r = await fetch(`/api/catalog/products/${id}`, { method: 'DELETE' })
    if (r.ok) {
      setProducts((current) => current.filter((p) => p.id !== id))
      toast.success('Produto removido.')
    } else {
      toast.error('Não foi possível remover o produto.')
    }
  }

  async function toggleProduct(p: Product) {
    const r = await fetch(`/api/catalog/products/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !p.is_active }),
    })
    const b = await r.json().catch(() => ({}))
    if (r.ok) setProducts((current) => current.map((x) => (x.id === p.id ? b.product : x)))
    else toast.error(b.error ?? 'Não foi possível actualizar o produto.')
  }

  async function saveProductEdits(p: Product, patch: { category?: string | null; color?: string | null; description?: string | null }) {
    const r = await fetch(`/api/catalog/products/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const b = await r.json().catch(() => ({}))
    if (r.ok) {
      setProducts((current) => current.map((x) => (x.id === p.id ? b.product : x)))
      toast.success('Produto actualizado.')
    } else {
      toast.error(b.error ?? 'Não foi possível actualizar o produto.')
    }
  }

  function addBulkFiles(files: File[]) {
    const items: BulkItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      imageUrl: null,
      uploading: true,
      classifying: false,
      name: '',
      price: '',
      category: null,
      color: null,
      description: '',
    }))
    setBulkItems((current) => [...current, ...items])
    for (const item of items) void processBulkItem(item)
  }

  async function processBulkItem(item: BulkItem) {
    try {
      const form = new FormData()
      form.append('file', item.file)
      const r = await fetch('/api/catalog/upload', { method: 'POST', body: form })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(b.error ?? 'Falha no carregamento.')
      setBulkItems((current) => current.map((x) => (x.id === item.id ? { ...x, imageUrl: b.url, uploading: false, classifying: true } : x)))
      const cr = await fetch('/api/catalog/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: b.url }),
      })
      const cb = await cr.json().catch(() => ({}))
      setBulkItems((current) =>
        current.map((x) =>
          x.id === item.id
            ? { ...x, classifying: false, category: cr.ok ? cb.category : null, color: cr.ok ? cb.color : null, description: cr.ok ? cb.description ?? '' : '' }
            : x,
        ),
      )
    } catch (e) {
      setBulkItems((current) =>
        current.map((x) => (x.id === item.id ? { ...x, uploading: false, classifying: false, error: e instanceof Error ? e.message : 'Erro.' } : x)),
      )
    }
  }

  function updateBulkItem(id: string, patch: Partial<BulkItem>) {
    setBulkItems((current) => current.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }
  function removeBulkItem(id: string) {
    setBulkItems((current) => {
      const item = current.find((x) => x.id === id)
      if (item) URL.revokeObjectURL(item.previewUrl)
      return current.filter((x) => x.id !== id)
    })
  }

  async function saveAllBulk() {
    const ready = bulkItems.filter(isBulkItemComplete)
    if (ready.length === 0) {
      toast.error('Preenche nome e preço de pelo menos um produto.')
      return
    }
    setBulkSaving(true)
    let saved = 0
    for (const item of ready) {
      try {
        const r = await fetch('/api/catalog/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: item.name, price: item.price, image_url: item.imageUrl, description: item.description, category: item.category, color: item.color }),
        })
        const b = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(b.error ?? 'Erro ao gravar.')
        setProducts((current) => [b.product, ...current])
        saved += 1
        removeBulkItem(item.id)
      } catch (e) {
        toast.error(`${item.name || 'Produto'}: ${e instanceof Error ? e.message : 'erro'}`)
      }
    }
    setBulkSaving(false)
    if (saved > 0) toast.success(`${saved} produto(s) adicionado(s).`)
  }

  function openReclassify() {
    setResult(null)
    setProgress(null)
    setDialogOpen(true)
  }

  async function runReclassify() {
    const targets = products.filter((p) => p.image_url)
    if (targets.length === 0) return
    setRunning(true)
    setProgress({ current: 0, total: targets.length, label: targets[0].name })
    let classified = 0
    let needsReview = 0
    let failed = 0
    const failedNames: string[] = []

    for (const [index, p] of targets.entries()) {
      setProgress({ current: index + 1, total: targets.length, label: p.name })
      try {
        const cr = await fetch('/api/catalog/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: p.image_url }),
        })
        const cb = await cr.json().catch(() => ({}))
        if (!cr.ok) throw new Error(cb.error ?? 'Erro ao classificar.')

        const patch: { category?: string | null; color?: string | null; description?: string | null } =
          mode === 'review_all'
            ? { category: cb.category ?? null, color: cb.color ?? null, description: cb.description || null }
            : {
                category: p.category ? undefined : cb.category ?? null,
                color: p.color ? undefined : cb.color ?? null,
                description: p.description ? undefined : cb.description || undefined,
              }

        const hasChange = Object.values(patch).some((value) => value !== undefined)
        if (hasChange) {
          const r = await fetch(`/api/catalog/products/${p.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          })
          const b = await r.json().catch(() => ({}))
          if (r.ok) setProducts((current) => current.map((x) => (x.id === p.id ? b.product : x)))
        }

        if (!cb.category || !cb.color) needsReview += 1
        else classified += 1
      } catch (e) {
        failed += 1
        failedNames.push(p.name)
        console.error('[catalog] classify existing product failed:', p.id, e)
      }
    }

    setRunning(false)
    setProgress(null)
    setResult({ classified, needsReview, failed, failedNames })
  }

  const targetCount = products.filter((p) => p.image_url).length

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Adicionar produto rápido</CardTitle>
          <CardDescription>Nome e preço são obrigatórios.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitProduct} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input required value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <div className="space-y-2">
                <Label>Preço</Label>
                <Input type="number" min="0" step="0.01" required value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Moeda</Label>
                <Input value={productForm.currency} onChange={(e) => setProductForm({ ...productForm, currency: e.target.value.toUpperCase() })} />
              </div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Fotografia</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f) }} />
                <Input type="url" placeholder="ou cole uma URL pública" value={productForm.image_url} onChange={(e) => setProductForm({ ...productForm, image_url: e.target.value })} />
              </div>
              {uploading ? (
                <p className="text-xs text-muted-foreground">
                  <Upload className="mr-1 inline h-3 w-3" />A carregar...
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Input value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Stock</Label>
              <Input type="number" min="0" value={productForm.stock_quantity} onChange={(e) => setProductForm({ ...productForm, stock_quantity: e.target.value })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Página do produto</Label>
              <Input type="url" value={productForm.product_url} onChange={(e) => setProductForm({ ...productForm, product_url: e.target.value })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Descrição</Label>
              <Textarea value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={savingProduct || uploading}>
                {savingProduct ? <Loader2 className="animate-spin" /> : <Plus />}
                Adicionar produto
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Adicionar vários produtos de uma vez</CardTitle>
          <CardDescription>Arrasta várias fotos — a IA sugere categoria, cor e descrição para cada uma; tu só confirmas nome e preço antes de gravar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <BulkUploadDropzone onFiles={addBulkFiles} disabled={bulkSaving} />
          {bulkItems.length > 0 ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {bulkItems.map((item) => (
                  <BulkItemCard
                    key={item.id}
                    item={item}
                    categoryOptions={categoryOptions}
                    colorOptions={colorOptions}
                    onCreateCategory={(label) => createTerm('category', label)}
                    onCreateColor={(label) => createTerm('color', label)}
                    onChange={(patch) => updateBulkItem(item.id, patch)}
                    onRemove={() => removeBulkItem(item.id)}
                  />
                ))}
              </div>
              <Button onClick={() => void saveAllBulk()} disabled={bulkSaving}>
                {bulkSaving ? <Loader2 className="animate-spin" /> : <Plus />}
                Guardar todos
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Produtos</h2>
        <Button variant="outline" onClick={openReclassify} disabled={targetCount === 0}>
          <Sparkles />
          Organizar produtos com IA
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {products.length === 0 ? (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="py-10 text-center text-muted-foreground">Sem produtos.</CardContent>
          </Card>
        ) : (
          products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              categoryOptions={categoryOptions}
              colorOptions={colorOptions}
              onCreateCategory={(label) => createTerm('category', label)}
              onCreateColor={(label) => createTerm('color', label)}
              onToggle={() => void toggleProduct(p)}
              onRemove={() => void removeProduct(p.id)}
              onSave={(patch) => saveProductEdits(p, patch)}
            />
          ))
        )}
      </div>

      <ReclassifyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        totalCount={targetCount}
        mode={mode}
        onModeChange={setMode}
        onConfirm={() => void runReclassify()}
        running={running}
        progress={progress}
        result={result}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  )
}
