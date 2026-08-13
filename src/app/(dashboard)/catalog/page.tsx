'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, PackageSearch, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ExternalIntegrationsTab, type Source } from '@/components/catalog/external-integrations-tab'
import { ProductsTab } from '@/components/catalog/products-tab'
import { TaxonomyManager } from '@/components/catalog/taxonomy-manager'
import type { Product } from '@/components/catalog/product-card'

type DatabaseStats = {
  totalProductRecords: number
  totalVariantRecords: number
  sources: Array<{
    sourceId: string
    sourceName: string
    ok: boolean
    productRecords: number
    variantRecords: number
    tables: Array<{ table: string; kind: string; count: number }>
    error?: string
  }>
}

export default function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [databaseStats, setDatabaseStats] = useState<DatabaseStats>({ totalProductRecords: 0, totalVariantRecords: 0, sources: [] })
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [a, b, c] = await Promise.all([
        fetch('/api/catalog/products', { cache: 'no-store' }),
        fetch('/api/catalog/sources', { cache: 'no-store' }),
        fetch('/api/catalog/sources/stats', { cache: 'no-store' }),
      ])
      const pa = await a.json().catch(() => ({}))
      const pb = await b.json().catch(() => ({}))
      const pc = await c.json().catch(() => ({}))
      if (!a.ok) throw new Error(pa.error ?? 'Não foi possível carregar os produtos.')
      if (!b.ok && b.status !== 403) throw new Error(pb.error ?? 'Não foi possível carregar as fontes.')
      setProducts(pa.products ?? [])
      setSources(pb.sources ?? [])
      if (c.ok) setDatabaseStats({ totalProductRecords: pc.totalProductRecords ?? 0, totalVariantRecords: pc.totalVariantRecords ?? 0, sources: pc.sources ?? [] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar o catálogo.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void loadData()
  }, [loadData])

  const activeProducts = useMemo(() => products.filter((p) => p.is_active), [products])
  const externalSourceCount = sources.length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <PackageSearch className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Catálogo</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Produtos, categorias e cores usados pelo agente no WhatsApp.</p>
        </div>
        <Button variant="outline" onClick={() => void loadData()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Actualizar
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card size="sm">
          <CardHeader>
            <CardDescription>Produtos internos activos</CardDescription>
            <CardTitle>{activeProducts.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Produtos via base de dados</CardDescription>
            <CardTitle>{loading ? '—' : databaseStats.totalProductRecords}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Variantes via base de dados</CardDescription>
            <CardTitle>{loading ? '—' : databaseStats.totalVariantRecords}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Fontes externas (beta)</CardDescription>
            <CardTitle>{externalSourceCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {databaseStats.sources.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {databaseStats.sources.map((stat) => (
            <Card key={stat.sourceId} size="sm">
              <CardHeader>
                <CardDescription>{stat.sourceName}</CardDescription>
                <CardTitle>{stat.ok ? `${stat.productRecords} produto(s)` : 'Indisponível'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                {stat.ok ? (
                  <>
                    {stat.tables.map((table) => (
                      <div key={`${stat.sourceId}:${table.table}`} className="flex justify-between gap-3">
                        <span>{table.table}</span>
                        <span>{table.count}</span>
                      </div>
                    ))}
                    <div className="flex justify-between gap-3 border-t pt-1">
                      <span>Variantes</span>
                      <span>{stat.variantRecords}</span>
                    </div>
                  </>
                ) : (
                  <p>{stat.error ?? 'Não foi possível consultar a fonte.'}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Produtos</TabsTrigger>
          <TabsTrigger value="taxonomy">Categorias</TabsTrigger>
          <TabsTrigger value="external">
            Integrações externas{externalSourceCount ? ` (${externalSourceCount})` : ''}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="mt-4">
          <ProductsTab products={products} setProducts={setProducts} />
        </TabsContent>
        <TabsContent value="taxonomy" className="mt-4">
          <TaxonomyManager />
        </TabsContent>
        <TabsContent value="external" className="mt-4">
          <ExternalIntegrationsTab sources={sources} setSources={setSources} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
