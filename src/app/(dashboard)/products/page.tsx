"use client"

// ============================================================
// /products — the catalogue + sales module.
//
//   ?tab=products (default) — the catalogue: products list with
//     edit / activate / delete, plus a "New product" CTA.
//   ?tab=orders            — the sales log: every order a keyword
//     flow created, with admin manual-fulfilment controls.
//
// Tab state lives in the URL (`?tab=`) so it deep-links and
// survives reloads, mirroring the Settings rail.
// ============================================================

import { Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Package, Plus, ShoppingCart } from "lucide-react"

import { useCan } from "@/hooks/use-can"
import { GatedButton } from "@/components/ui/gated-button"
import { cn } from "@/lib/utils"
import { ProductList } from "@/components/products/product-list"
import { OrdersList } from "@/components/products/orders-list"

export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsPageInner />
    </Suspense>
  )
}

type ProductsTab = "products" | "orders"

function ProductsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const canCreate = useCan("send-messages")
  const t = useTranslations("Products")

  const raw = searchParams.get("tab")
  const tab: ProductsTab = raw === "orders" ? "orders" : "products"

  const go = (next: ProductsTab) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === "products") params.delete("tab")
    else params.set("tab", next)
    router.replace(`/products${params.toString() ? `?${params}` : ""}`, { scroll: false })
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("pageTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("pageDesc")}</p>
        </div>
        {tab === "products" && (
          <GatedButton
            canAct={canCreate}
            gateReason="create products"
            onClick={() => router.push("/products/new")}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t("newProduct")}
          </GatedButton>
        )}
      </div>

      {/* Tab strip */}
      <div className="mt-6 flex items-center gap-1 border-b border-border">
        <TabButton active={tab === "products"} onClick={() => go("products")}>
          <Package className="h-4 w-4" />
          {t("tabs.products")}
        </TabButton>
        <TabButton active={tab === "orders"} onClick={() => go("orders")}>
          <ShoppingCart className="h-4 w-4" />
          {t("tabs.orders")}
        </TabButton>
      </div>

      <div className="mt-4">
        {tab === "products" ? <ProductList /> : <OrdersList />}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 pb-2 pt-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
