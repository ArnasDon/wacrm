'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Search,
  Loader2,
  ShoppingCart,
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  MoreHorizontal,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw row coming back from Supabase (order_items joined with orders + produits) */
interface RawItem {
  id: string
  order_id: string
  item_price: number | null
  quantity: number | null
  produits: {
    title: string | null
    price: number | null
    sale_price: number | null
    sale_price_starts_at: string | null
    sale_price_ends_at: string | null
  } | null
  orders: { contact_name: string | null; created_at: string | null; status: string | null } | null
}

/** Flat display row after normalisation */
interface DisplayRow {
  order_id: string
  contact_name: string | null
  products: string
  total: number
  created_at: string | null
  status: string | null
}

/** Orders grouped by order_id for rendering */
interface OrderGroup {
  order_id: string
  contact_name: string | null
  created_at: string | null
  status: string | null
  grand_total: number
  productSummary: string
  rows: DisplayRow[]
}

const PAGE_SIZE = 50 // groups per page

interface ProductOption {
  id: string
  title: string | null
  price: number | null
  sale_price: number | null
  sale_price_starts_at: string | null
  sale_price_ends_at: string | null
}

interface ContactOption {
  id: string
  name: string | null
  phone: string | null
}

interface OrderFormState {
  contactName: string
  productId: string
  quantity: string
  status: string
  createdAt: string
}

const EMPTY_ORDER_FORM: OrderFormState = {
  contactName: '',
  productId: '',
  quantity: '1',
  status: 'pending',
  createdAt: new Date().toISOString().slice(0, 16),
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSalePriceActive(product: RawItem['produits'], orderDate: string | null) {
  if (!product) return false

  const referenceDate = orderDate ? new Date(orderDate) : new Date()
  const startsAt = product.sale_price_starts_at ? new Date(product.sale_price_starts_at) : null
  const endsAt = product.sale_price_ends_at ? new Date(product.sale_price_ends_at) : null

  if (startsAt && endsAt) {
    return startsAt <= referenceDate && referenceDate <= endsAt
  }

  if (startsAt) {
    return referenceDate >= startsAt
  }

  if (endsAt) {
    return referenceDate <= endsAt
  }

  return false
}

function getDisplayPrice(item: RawItem) {
  const product = item.produits
  if (!product) return item.item_price ?? 0

  const orderDate = item.orders?.created_at ?? null
  if (isSalePriceActive(product, orderDate) && product.sale_price != null) {
    return product.sale_price
  }

  return product.price ?? item.item_price ?? 0
}

function groupByOrder(items: RawItem[]): OrderGroup[] {
  const map = new Map<string, OrderGroup>()

  for (const item of items) {
    const qty = item.quantity ?? 0
    const price = getDisplayPrice(item)
    const total = qty * price

    if (!map.has(item.order_id)) {
      map.set(item.order_id, {
        order_id: item.order_id,
        contact_name: item.orders?.contact_name ?? null,
        created_at: item.orders?.created_at ?? null,
        status: item.orders?.status ?? null,
        grand_total: 0,
        productSummary: '',
        rows: [],
      })
    }

    const group = map.get(item.order_id)!
    group.grand_total += total

    const title = item.produits?.title ?? 'Produit inconnu'
    const productEntry = `${title}(${qty})`
    group.productSummary = group.productSummary ? `${group.productSummary}, ${productEntry}` : productEntry
  }

  return Array.from(map.values()).map((group) => ({
    ...group,
    rows: [
      {
        order_id: group.order_id,
        contact_name: group.contact_name,
        products: group.productSummary,
        total: group.grand_total,
        created_at: group.created_at,
        status: group.status,
      },
    ],
  }))
}

function fmtCurrency(val: number) {
  return val.toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  })
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function shortId(id: string) {
  // Show last 8 chars of UUID for readability
  return '…' + id.slice(-8)
}

function getStatusBadge(status: string | null) {
  if (!status) return '—'
  const s = status.toLowerCase()
  if (s === 'pending' || s === 'en attente') {
    return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20">{status}</Badge>
  }
  if (s === 'paid' || s === 'payé' || s === 'completed' || s === 'terminé') {
    return <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">{status}</Badge>
  }
  if (s === 'cancelled' || s === 'annulé' || s === 'failed') {
    return <Badge variant="outline" className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">{status}</Badge>
  }
  return <Badge variant="outline" className="text-foreground">{status}</Badge>
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CommandesPage() {
  const supabase = createClient()
  const { account } = useAuth()

  const [groups, setGroups] = useState<OrderGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [totalGroups, setTotalGroups] = useState(0)
  const [products, setProducts] = useState<ProductOption[]>([])
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<RawItem | null>(null)
  const [formData, setFormData] = useState<OrderFormState>(EMPTY_ORDER_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RawItem | null>(null)

  // -------------------------------------------------------------------
  // Fetch — we query order_items and join orders + produits
  // -------------------------------------------------------------------

  const fetchCommandes = useCallback(async () => {
    if (!account?.id) return
    setLoading(true)

    // 1. Get the distinct order_ids for this page (for pagination by order)
    //    We paginate by order, not by item rows.
    let orderQuery = supabase
      .from('orders')
      .select('id', { count: 'exact' })
      .eq('account_id', account.id)
      .order('created_at', { ascending: false })

    if (search.trim()) {
      orderQuery = orderQuery.ilike('contact_name', `%${search.trim()}%`)
    }

    const { data: orderIds, error: orderErr, count } = await orderQuery
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (orderErr) {
      console.error('Failed to fetch orders:', orderErr)
      toast.error('Erreur lors du chargement des commandes')
      setLoading(false)
      return
    }

    setTotalGroups(count ?? 0)

    if (!orderIds || orderIds.length === 0) {
      setGroups([])
      setLoading(false)
      return
    }

    const ids = orderIds.map((o) => o.id)

    // 2. Fetch all order_items for those orders, joined with orders + produits
    const { data: items, error: itemsErr } = await supabase
      .from('order_items')
      .select(`
        id,
        order_id,
        item_price,
        quantity,
        produits ( title, price, sale_price, sale_price_starts_at, sale_price_ends_at ),
        orders ( contact_name, created_at, status )
      `)
      .in('order_id', ids)
      .order('order_id', { ascending: false })

    if (itemsErr) {
      console.error('Failed to fetch order_items:', itemsErr)
      toast.error('Erreur lors du chargement des articles')
      setLoading(false)
      return
    }

    // Sort items to respect the order of `ids` (page ordering by created_at desc)
    const sorted = [...(items ?? [])].sort((a, b) => {
      return ids.indexOf(a.order_id) - ids.indexOf(b.order_id)
    })

    setGroups(groupByOrder(sorted as unknown as RawItem[]))
    setLoading(false)
  }, [supabase, account?.id, page, search])

  useEffect(() => {
    fetchCommandes()
  }, [fetchCommandes])

  useEffect(() => {
    setPage(0)
  }, [search])

  useEffect(() => {
    const loadProducts = async () => {
      const { data } = await supabase.from('produits').select('id,title,price,sale_price,sale_price_starts_at,sale_price_ends_at').order('title', { ascending: true })
      setProducts((data ?? []) as ProductOption[])
    }

    void loadProducts()
  }, [supabase])

  useEffect(() => {
    const loadContacts = async () => {
      const { data } = await supabase.from('contacts').select('id,name,phone').order('name', { ascending: true })
      setContacts((data ?? []) as ContactOption[])
    }

    void loadContacts()
  }, [supabase])

  function openCreateModal() {
    setEditingItem(null)
    setFormData(EMPTY_ORDER_FORM)
    setFormOpen(true)
  }

  function openEditModal(item: RawItem) {
    setEditingItem(item)
    setFormData({
      contactName: item.orders?.contact_name ?? '',
      productId: item.produits?.title ? '' : '',
      quantity: String(item.quantity ?? 1),
      status: item.orders?.status ?? 'pending',
      createdAt: item.orders?.created_at ? new Date(item.orders.created_at).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
    })
    setFormOpen(true)
  }

  async function handleSave() {
    if (!account?.id) {
      toast.error('Aucun compte actif')
      return
    }

    if (!formData.productId) {
      toast.error('Veuillez sélectionner un produit')
      return
    }

    const quantity = Number(formData.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error('La quantité doit être supérieure à 0')
      return
    }

    setSaving(true)

    try {
      const createdAt = formData.createdAt ? new Date(formData.createdAt).toISOString() : new Date().toISOString()
      const { data: orderData, error: orderError } = await supabase.from('orders').insert({
        account_id: account.id,
        contact_name: formData.contactName.trim() || null,
        status: formData.status || 'pending',
        created_at: createdAt,
      }).select('id').single()

      if (orderError || !orderData?.id) {
        throw orderError ?? new Error('Impossible de créer la commande')
      }

      const { error: itemError } = await supabase.from('order_items').insert({
        order_id: orderData.id,
        produit_id: formData.productId,
        quantity,
        item_price: null,
      })

      if (itemError) {
        throw itemError
      }

      toast.success('Commande créée avec succès')
      setFormOpen(false)
      setFormData(EMPTY_ORDER_FORM)
      fetchCommandes()
    } catch (error: any) {
      console.error('Order save error:', error)
      toast.error(error?.message || 'Erreur lors de la sauvegarde de la commande')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return

    setDeleting(true)
    try {
      const { error: itemError } = await supabase.from('order_items').delete().eq('order_id', deleteTarget.order_id)
      if (itemError) throw itemError

      const { error: orderError } = await supabase.from('orders').delete().eq('id', deleteTarget.order_id)
      if (orderError) throw orderError

      toast.success('Commande supprimée')
      setDeleteTarget(null)
      fetchCommandes()
    } catch (error: any) {
      console.error('Order delete error:', error)
      toast.error(error?.message || 'Erreur lors de la suppression')
    } finally {
      setDeleting(false)
    }
  }

  // -------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------

  const totalPages = Math.max(1, Math.ceil(totalGroups / PAGE_SIZE))
  const canPrev = page > 0
  const canNext = page < totalPages - 1

  // Total item rows (for colSpan on empty state)
  const COL_COUNT = 9

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Commandes</h1>
        </div>
        <Button onClick={openCreateModal} className="gap-2">
          <Plus className="h-4 w-4" />
          Nouvelle commande
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Rechercher par contact…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card flex-1 overflow-auto [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/60 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-border/80">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-foreground font-medium">ID</TableHead>
              <TableHead className="text-foreground font-medium">Contact</TableHead>
              <TableHead className="text-foreground font-medium">Produit</TableHead>
              <TableHead className="text-right text-foreground font-medium">Total</TableHead>
              <TableHead className="text-foreground font-medium">Statut</TableHead>
              <TableHead className="text-foreground font-medium">Date</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={COL_COUNT} className="h-32 text-center">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Chargement…
                  </div>
                </TableCell>
              </TableRow>
            ) : groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COL_COUNT} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <ShoppingCart className="h-8 w-8 opacity-40" />
                    {search ? 'Aucune commande trouvée' : 'Aucune commande pour le moment'}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              groups.map((group) => {
                const row = group.rows[0]
                if (!row) return null

                return (
                  <TableRow key={group.order_id} className="hover:bg-muted/40">
                    <TableCell className="font-mono text-xs text-foreground/90">
                      <span title={row.order_id}>{shortId(row.order_id)}</span>
                    </TableCell>

                    <TableCell className="font-medium text-foreground" title={row.contact_name || undefined}>
                      <div className="break-words whitespace-normal">
                        {row.contact_name || '—'}
                      </div>
                    </TableCell>

                    <TableCell className="max-w-[260px] break-words whitespace-normal text-foreground/90" title={row.products || undefined}>
                      {row.products || '—'}
                    </TableCell>

                    <TableCell className="text-right tabular-nums font-semibold text-foreground">
                      {fmtCurrency(row.total)}
                    </TableCell>

                    <TableCell className="align-middle capitalize">
                      {getStatusBadge(row.status)}
                    </TableCell>

                    <TableCell className="align-middle text-foreground font-medium">
                      {fmtDate(row.created_at)}
                    </TableCell>

                    <TableCell className="w-12 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button
                              type="button"
                              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                            />
                          }
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-36 bg-popover text-popover-foreground ring-border">
                          <DropdownMenuItem onClick={() => openEditModal({ id: row.order_id, order_id: row.order_id, item_price: 0, quantity: 1, produits: null, orders: { contact_name: row.contact_name, created_at: row.created_at, status: row.status } } as RawItem)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Modifier
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setDeleteTarget({ id: row.order_id, order_id: row.order_id, item_price: 0, quantity: 1, produits: null, orders: { contact_name: row.contact_name, created_at: row.created_at, status: row.status } } as RawItem)} className="text-red-400 focus:text-red-400">
                            <Trash2 className="mr-2 h-4 w-4" />
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalGroups > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-sm text-muted-foreground">
              Commandes {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalGroups)} sur{' '}
              {totalGroups}
            </p>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={!canPrev}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={!canNext}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Modifier la commande' : 'Nouvelle commande'}</DialogTitle>
            <DialogDescription>
              {editingItem ? 'Modifiez les détails de la commande.' : 'Créez une nouvelle commande avec un produit et une quantité.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="contact-name">Contact</Label>
              <div className="rounded-lg border border-input bg-muted/20 p-2">
                <select
                  id="contact-name"
                  value={formData.contactName}
                  onChange={(e) => setFormData((prev) => ({ ...prev, contactName: e.target.value }))}
                  style={{ fontFamily: 'monospace' }}
                  className="w-full rounded-md bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="" hidden />
                  {contacts.map((contact) => {
                    const name = contact.name ?? ''
                    const phone = contact.phone ?? ''
                    const label = phone ? name.padEnd(30, '\u00a0') + phone : name
                    return (
                      <option key={contact.id} value={name}>
                        {label}
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="product-id">Produit</Label>
              <div className="rounded-lg border border-input bg-muted/20 p-2">
                <select
                  id="product-id"
                  value={formData.productId}
                  onChange={(e) => setFormData((prev) => ({ ...prev, productId: e.target.value }))}
                  className="w-full rounded-md bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="" hidden />
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.title || 'Produit sans nom'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">Quantité</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                step="1"
                value={formData.quantity}
                onChange={(e) => setFormData((prev) => ({ ...prev, quantity: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Statut</Label>
              <select
                id="status"
                value={formData.status}
                onChange={(e) => setFormData((prev) => ({ ...prev, status: e.target.value }))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="pending">En attente</option>
                <option value="paid">Payée</option>
                <option value="cancelled">Annulée</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="created-at">Date</Label>
              <Input
                id="created-at"
                type="datetime-local"
                value={formData.createdAt}
                onChange={(e) => setFormData((prev) => ({ ...prev, createdAt: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Enregistrement…' : editingItem ? 'Enregistrer' : 'Créer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Supprimer la commande</DialogTitle>
            <DialogDescription>
              Cette action supprimera la commande et l’article associé.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Suppression…' : 'Supprimer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
