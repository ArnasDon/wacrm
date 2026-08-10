"use client"

// ============================================================
// /products/new — create a product. The form owns the file
// upload (to a signed upload URL) and the POST to /api/products.
// ============================================================

import { useTranslations } from "next-intl"
import { ProductForm } from "@/components/products/product-form"

export default function NewProductPage() {
  const t = useTranslations("Products.new")
  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("pageTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("pageDesc")}</p>
      </div>
      <div className="mt-6">
        <ProductForm />
      </div>
    </div>
  )
}
