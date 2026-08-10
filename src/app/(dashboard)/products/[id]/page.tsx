"use client"

// ============================================================
// /products/[id] — edit a product. Loads the row from
// /api/products/[id], then hands it to ProductForm (edit mode).
// ============================================================

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"

import { ProductForm } from "@/components/products/product-form"
import { Button } from "@/components/ui/button"
import type { Product } from "@/types"

export default function EditProductPage() {
  const params = useParams<{ id: string }>()
  const t = useTranslations("Products.edit")
  const id = params?.id

  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/products/${id}`, { cache: "no-store" })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? "Failed to load product")
        }
        const data = (await res.json()) as { product: Product }
        if (!cancelled) setProduct(data.product)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load product")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40">
        <p className="text-sm text-red-400">{error ?? "Product not found"}</p>
        <Button variant="outline" onClick={() => window.history.back()}>
          Go back
        </Button>
      </div>
    )
  }

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("pageTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("pageDesc")}</p>
      </div>
      <div className="mt-6">
        <ProductForm key={product.id} initial={product} />
      </div>
    </div>
  )
}
