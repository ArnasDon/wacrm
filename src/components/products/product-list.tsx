"use client"

// ============================================================
// ProductList — the Products tab of the Products section.
//
// Loads the account's products from /api/products and renders them
// with the actions agents+ expect: edit, toggle active, delete.
// Orders and the sales flow live next door in OrdersList — this
// component owns nothing but the catalogue rows.
// ============================================================

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  ShoppingCart,
  Trash2,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useCan } from "@/hooks/use-can"
import { formatProductPrice } from "@/lib/products/messages"
import { cn } from "@/lib/utils"
import type { Product, ProductKind } from "@/types"

export function ProductList({ onChanged }: { onChanged?: () => void }) {
  const t = useTranslations("Products.list")
  const router = useRouter()
  const canEdit = useCan("send-messages")

  const [products, setProducts] = useState<Product[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/products", { cache: "no-store" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? "Failed to load products")
      }
      const data = (await res.json()) as { products: Product[] }
      setProducts(data.products)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggleActive(product: Product, next: boolean) {
    setTogglingId(product.id)
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? "Failed to update product")
        return
      }
      setProducts((prev) =>
        prev?.map((p) => (p.id === product.id ? { ...p, is_active: next } : p)) ?? prev,
      )
      onChanged?.()
    } finally {
      setTogglingId(null)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/products/${pendingDelete.id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? "Failed to delete product")
        return
      }
      toast.success(t("deleted"))
      setPendingDelete(null)
      await load()
      onChanged?.()
    } finally {
      setDeleting(false)
    }
  }

  if (error) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    )
  }

  if (products === null) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (products.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <ShoppingCart className="h-6 w-6 text-primary" />
        </div>
        <p className="mt-3 text-sm font-medium text-foreground">{t("emptyTitle")}</p>
        <p className="mt-1 max-w-sm text-center text-xs text-muted-foreground">
          {t("emptyDesc")}
        </p>
        <GatedButton
          canAct={canEdit}
          gateReason="create products"
          onClick={() => router.push("/products/new")}
          className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t("newProduct")}
        </GatedButton>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border bg-muted/50 hover:bg-muted/50">
              <TableHead className="text-xs text-muted-foreground">{t("productColumn")}</TableHead>
              <TableHead className="hidden text-xs text-muted-foreground sm:table-cell">
                {t("typeColumn")}
              </TableHead>
              <TableHead className="text-xs text-muted-foreground">{t("priceColumn")}</TableHead>
              <TableHead className="text-xs text-muted-foreground">{t("statusColumn")}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <ProductRow
                key={p.id}
                product={p}
                canEdit={canEdit}
                toggling={togglingId === p.id}
                onToggle={(next) => toggleActive(p, next)}
                onEdit={() => router.push(`/products/${p.id}`)}
                onDelete={() => setPendingDelete(p)}
                t={t}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!pendingDelete} onOpenChange={(v) => !v && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteDesc", { name: pendingDelete?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

const KIND_ICON: Record<ProductKind, LucideIcon> = {
  digital: ShoppingCart,
  physical: ShoppingCart,
}

function ProductRow({
  product,
  canEdit,
  toggling,
  onToggle,
  onEdit,
  onDelete,
  t,
}: {
  product: Product
  canEdit: boolean
  toggling: boolean
  onToggle: (next: boolean) => void
  onEdit: () => void
  onDelete: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const KindIcon = KIND_ICON[product.kind]
  return (
    <TableRow className="border-border hover:bg-muted/40">
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <KindIcon className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{product.name}</div>
            {product.description ? (
              <div className="truncate text-xs text-muted-foreground">{product.description}</div>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Badge variant="outline" className="border-border text-muted-foreground">
          {t(product.kind)}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm tabular-nums text-foreground">
        {formatProductPrice(product.price, product.currency)}
      </TableCell>
      <TableCell>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium",
            product.is_active ? "text-emerald-500" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              product.is_active ? "bg-emerald-500" : "bg-muted-foreground/50",
            )}
            aria-hidden
          />
          {product.is_active ? t("active") : t("inactive")}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-2">
          <Switch
            checked={product.is_active}
            onCheckedChange={(v) => onToggle(!!v)}
            disabled={!canEdit || toggling}
            aria-label={product.is_active ? t("deactivate") : t("activate")}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Open menu"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted"
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit} disabled={!canEdit}>
                <Pencil className="h-4 w-4" />
                {t("edit")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete} disabled={!canEdit}>
                <Trash2 className="h-4 w-4" />
                {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}
