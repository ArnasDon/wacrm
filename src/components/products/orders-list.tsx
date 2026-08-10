"use client"

// ============================================================
// OrdersList — the Orders tab of the Products section.
//
// Every order a keyword flow created lives here. Admins can also
// mark a `pending` order Paid manually — the WhatsApp confirmation
// and download link are sent by the fulfillment layer, same as if a
// webhook had confirmed it.
// ============================================================

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  CheckCircle2,
  Inbox,
  Loader2,
  RefreshCw,
  XCircle,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useCan } from "@/hooks/use-can"
import { formatProductPrice } from "@/lib/products/messages"
import { cn } from "@/lib/utils"
import type { ProductOrder, ProductOrderStatus } from "@/types"

type OrderRow = ProductOrder & { contact_name?: string | null }

const STATUS_ICON: Record<ProductOrderStatus, LucideIcon> = {
  pending: Loader2,
  paid: CheckCircle2,
  cancelled: XCircle,
  failed: XCircle,
}

const STATUS_CLASSES: Record<ProductOrderStatus, string> = {
  pending: "border-amber-500/40 text-amber-500",
  paid: "border-emerald-500/40 text-emerald-500",
  cancelled: "border-border text-muted-foreground",
  failed: "border-red-500/40 text-red-500",
}

export function OrdersList({ onChanged }: { onChanged?: () => void }) {
  const t = useTranslations("Products.orders")
  const isAdmin = useCan("edit-settings")

  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/orders", { cache: "no-store" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? "Failed to load orders")
      }
      const data = (await res.json()) as { orders: OrderRow[] }
      setOrders(data.orders)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders")
    }
  }, [])

  useEffect(() => {
    void load()
    // The webhook is server-side; keep this view honest while it's open.
    const interval = setInterval(() => void load(), 15_000)
    return () => clearInterval(interval)
  }, [load])

  async function setStatus(order: OrderRow, status: "paid" | "cancelled") {
    setUpdatingId(order.id)
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? "Failed to update order")
        return
      }
      toast.success(status === "paid" ? t("markedPaid") : t("markedCancelled"))
      await load()
      onChanged?.()
    } finally {
      setUpdatingId(null)
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

  if (orders === null) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Inbox className="h-6 w-6 text-primary" />
        </div>
        <p className="mt-3 text-sm font-medium text-foreground">{t("emptyTitle")}</p>
        <p className="mt-1 max-w-sm text-center text-xs text-muted-foreground">
          {t("emptyDesc")}
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
        <span className="text-xs text-muted-foreground">
          {t("count", { count: orders.length })}
        </span>
        <Button variant="ghost" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t("refresh")}
        </Button>
      </div>
      <ul className="divide-y divide-border">
        {orders.map((order) => {
          const StatusIcon = STATUS_ICON[order.status]
          const canUpdate = isAdmin && (order.status === "pending" || order.status === "failed")
          const updating = updatingId === order.id
          return (
            <li
              key={order.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <StatusIcon
                    className={cn(
                      "h-4 w-4",
                      order.status === "pending" ? "animate-spin text-amber-500" : "text-primary",
                    )}
                  />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {order.contact_name ?? order.contact_id ?? "—"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {order.product?.name ?? "—"}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="whitespace-nowrap text-sm tabular-nums text-foreground">
                  {formatProductPrice(order.amount, order.currency)}
                </span>
                <Badge variant="outline" className={cn("gap-1", STATUS_CLASSES[order.status])}>
                  <StatusIcon
                    className={cn("h-3 w-3", order.status === "pending" && "animate-spin")}
                  />
                  {t(`status.${order.status}`)}
                </Badge>
                {canUpdate && (
                  <div className="flex items-center gap-1.5">
                    {order.status !== "paid" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updating}
                        onClick={() => setStatus(order, "paid")}
                      >
                        {t("markPaid")}
                      </Button>
                    )}
                    {order.status === "pending" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={updating}
                        onClick={() => setStatus(order, "cancelled")}
                      >
                        {t("cancel")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
