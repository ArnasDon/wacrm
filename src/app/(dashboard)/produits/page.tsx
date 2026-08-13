'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { normalizeInventory } from '@/lib/inventory'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Package,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Produit {
  id: string
  title: string | null
  availability: string | null
  image_url: string | null
  quantity: number | null
  price: number | null
  sale_price: number | null
  sale_price_starts_at: string | null
  sale_price_ends_at: string | null
}

interface ProduitFormData {
  // Infos générales
  vertical: string
  external_id: string
  title: string
  description: string
  status: string
  // Médias & URL
  url: string
  image_url: string
  videos: string          // JSON textarea
  // Prix
  price: string
  currency: string
  sale_price: string
  sale_price_starts_at: string
  sale_price_ends_at: string
  rental_price: string
  booking_mode: string
  // Inventaire
  quantity: string
  availability: string
  condition: string
  // Identifiants produit
  brand: string
  gtin: string
  google_product_category: string
  fb_product_category: string
  item_group_id: string
  // Caractéristiques
  gender: string
  color: string
  size: string
  age_group: string
  material: string
  pattern: string
  style: string           // comma-separated → text[]
  // Livraison
  shipping: string        // JSON textarea
  shipping_weight_value: string
  shipping_weight_unit: string
  // Offre
  offer_disclaimer: string
  offer_disclaimer_url: string
  // Tags & Attributs
  product_tags: string    // comma-separated → text[]
  attributes: string      // JSON textarea
}

const EMPTY_FORM: ProduitFormData = {
  vertical: '',
  external_id: '',
  title: '',
  description: '',
  status: '',
  url: '',
  image_url: '',
  videos: '',
  price: '',
  currency: '',
  sale_price: '',
  sale_price_starts_at: '',
  sale_price_ends_at: '',
  rental_price: '',
  booking_mode: '',
  quantity: '',
  availability: '',
  condition: '',
  brand: '',
  gtin: '',
  google_product_category: '',
  fb_product_category: '',
  item_group_id: '',
  gender: '',
  color: '',
  size: '',
  age_group: '',
  material: '',
  pattern: '',
  style: '',
  shipping: '',
  shipping_weight_value: '',
  shipping_weight_unit: '',
  offer_disclaimer: '',
  offer_disclaimer_url: '',
  product_tags: '',
  attributes: '',
}

const PAGE_SIZE = 25

// ---------------------------------------------------------------------------
// Helper — parse optional JSON textarea
// ---------------------------------------------------------------------------
function parseJsonField(raw: string): object | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Helper — parse comma-separated list
// ---------------------------------------------------------------------------
function parseTags(raw: string): string[] | null {
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return items.length > 0 ? items : null
}

function isSalePriceActive(produit: Produit) {
  const now = new Date()
  const startsAt = produit.sale_price_starts_at ? new Date(produit.sale_price_starts_at) : null
  const endsAt = produit.sale_price_ends_at ? new Date(produit.sale_price_ends_at) : null

  if (startsAt && endsAt) {
    return startsAt <= now && now <= endsAt
  }

  if (startsAt) {
    return now >= startsAt
  }

  if (endsAt) {
    return now <= endsAt
  }

  return false
}

function getCurrentDisplayPrice(produit: Produit) {
  if (isSalePriceActive(produit) && produit.sale_price != null) {
    return produit.sale_price
  }

  return produit.price ?? null
}

// ---------------------------------------------------------------------------
// Section header helper component
// ---------------------------------------------------------------------------
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProduitsPage() {
  const supabase = createClient()
  const { account } = useAuth()

  // Data
  const [produits, setProduits] = useState<Produit[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  // Modal state
  const [formOpen, setFormOpen] = useState(false)
  const [editingProduit, setEditingProduit] = useState<Produit | null>(null)
  const [formData, setFormData] = useState<ProduitFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Produit | null>(null)
  const [deleting, setDeleting] = useState(false)

  // States pour le dropdown Google Product Category
  const [gpcLevel1Options, setGpcLevel1Options] = useState<string[]>([])
  const [gpcLevel2Options, setGpcLevel2Options] = useState<string[]>([])
  const [gpcLevel3Options, setGpcLevel3Options] = useState<{label: string, full_path: string}[]>([])
  const [gpcLevel1, setGpcLevel1] = useState('')
  const [gpcLevel2, setGpcLevel2] = useState('')

  // States pour le dropdown facebook Product Category
  const [fbpcLevel1Options, setFbpcLevel1Options] = useState<string[]>([])
  const [fbpcLevel2Options, setFbpcLevel2Options] = useState<string[]>([])
  const [fbpcLevel3Options, setFbpcLevel3Options] = useState<{label: string, full_path: string}[]>([])
  const [fbpcLevel1, setFbpcLevel1] = useState('')
  const [fbpcLevel2, setFbpcLevel2] = useState('')


  // -------------------------------------------------------------------
  // Fetch (table only needs 5 display columns)
  // -------------------------------------------------------------------

  const fetchProduits = useCallback(async () => {
    setLoading(true)
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabase
      .from('produits')
      .select('id,title,availability,image_url,quantity,price,sale_price,sale_price_starts_at,sale_price_ends_at', { count: 'exact' })
      .order('title', { ascending: true })
      .range(from, to)

    if (search.trim()) {
      query = query.ilike('title', `%${search.trim()}%`)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('Failed to fetch produits:', error)
      toast.error('Erreur lors du chargement des produits')
    } else {
      setProduits((data ?? []) as Produit[])
      setTotalCount(count ?? 0)
    }
    setLoading(false)
  }, [supabase, page, search])

  useEffect(() => {
    fetchProduits()
  }, [fetchProduits])

  useEffect(() => {
    setPage(0)
  }, [search])

  useEffect(() => {
  async function fetchLevel1() {
    const { data } = await supabase
      .from('google_product_categories')
      .select('level_1')
      .not('level_1', 'is', null)
      .order('level_1')
    
    const unique = [...new Set((data ?? []).map((d: any) => d.level_1))]
    setGpcLevel1Options(unique)
  }
  fetchLevel1()
}, [supabase])

useEffect(() => {
  if (!gpcLevel1) return
  async function fetchLevel2() {
    const { data } = await supabase
      .from('google_product_categories')
      .select('level_2')
      .eq('level_1', gpcLevel1)
      .not('level_2', 'is', null)
      .order('level_2')
    
    const unique = [...new Set((data ?? []).map((d: any) => d.level_2))]
    setGpcLevel2Options(unique)
    setGpcLevel2('')
    setField('google_product_category', '')
  }
  fetchLevel2()
}, [gpcLevel1, supabase])

useEffect(() => {
  if (!gpcLevel1 || !gpcLevel2) return
  async function fetchLevel3() {
    const { data } = await supabase
      .from('google_product_categories')
      .select('level_3, full_path')
      .eq('level_1', gpcLevel1)
      .eq('level_2', gpcLevel2)
      .not('level_3', 'is', null)
      .order('level_3')
    
    setGpcLevel3Options((data ?? []).map((d: any) => ({
      label: d.level_3,
      full_path: d.full_path
    })))
    setField('google_product_category', '')
  }
  fetchLevel3()
}, [gpcLevel1, gpcLevel2, supabase])

useEffect(() => {
  async function fetchLevel1() {
    const { data } = await supabase
      .from('fb_product_categories')
      .select('level_1')
      .not('level_1', 'is', null)
      .order('level_1')
    
    const unique = [...new Set((data ?? []).map((d: any) => d.level_1))]
    setFbpcLevel1Options(unique)
  }
  fetchLevel1()
}, [supabase])

useEffect(() => {
  if (!fbpcLevel1) return
  async function fetchLevel2() {
    const { data } = await supabase
      .from('fb_product_categories')
      .select('level_2')
      .eq('level_1', fbpcLevel1)
      .not('level_2', 'is', null)
      .order('level_2')
    
    const unique = [...new Set((data ?? []).map((d: any) => d.level_2))]
    setFbpcLevel2Options(unique)
    setFbpcLevel2('')
    setField('fb_product_category', '')
  }
  fetchLevel2()
}, [fbpcLevel1, supabase])

useEffect(() => {
  if (!fbpcLevel1 || !fbpcLevel2) return
  async function fetchLevel3() {
    const { data } = await supabase
      .from('fb_product_categories')
      .select('level_3, full_path')
      .eq('level_1', fbpcLevel1)
      .eq('level_2', fbpcLevel2)
      .not('level_3', 'is', null)
      .order('level_3')
    
    setFbpcLevel3Options((data ?? []).map((d: any) => ({
      label: d.level_3,
      full_path: d.full_path
    })))
    setField('fb_product_category', '')
  }
  fetchLevel3()
}, [fbpcLevel1, fbpcLevel2, supabase])

  // -------------------------------------------------------------------
  // Short helper to update a single form field
  // -------------------------------------------------------------------
  function setField<K extends keyof ProduitFormData>(key: K, value: ProduitFormData[K]) {
    setFormData((f) => ({ ...f, [key]: value }))
  }

  // -------------------------------------------------------------------
  // Create / Update
  // -------------------------------------------------------------------

  function openCreateModal() {
    setEditingProduit(null)
    setFormData(EMPTY_FORM)
    setFormOpen(true)
  }

  function openEditModal(produit: Produit) {
    setEditingProduit(produit)
    // Only pre-fill the fields that come from the table query;
    // the rest stay empty and can be filled in freely.
    setFormData({
      ...EMPTY_FORM,
      title: produit.title ?? '',
      availability: produit.availability ?? '',
      image_url: produit.image_url ?? '',
      quantity: produit.quantity != null ? String(produit.quantity) : '',
      sale_price: produit.sale_price != null ? String(produit.sale_price) : '',
    })
    setFormOpen(true)
  }

  async function handleSave() {
    if (!formData.title.trim()) {
      toast.error('Le titre du produit est requis')
      return
    }

    // Numeric conversions
    const price = formData.price ? parseFloat(formData.price) : null
    const sale_price = formData.sale_price ? parseFloat(formData.sale_price) : null
    const rental_price = formData.rental_price ? parseFloat(formData.rental_price) : null
    const quantity = formData.quantity ? parseInt(formData.quantity, 10) : null
    const shipping_weight_value = formData.shipping_weight_value
      ? parseFloat(formData.shipping_weight_value)
      : null

    const normalizedInventory = normalizeInventory(quantity, formData.availability)
    const resolvedAvailability = normalizedInventory.quantity > 0 ? 'in stock' : 'out of stock'

    // JSON fields
    const shipping = parseJsonField(formData.shipping)
    const videos = parseJsonField(formData.videos)
    const attributes = parseJsonField(formData.attributes)

    // Array fields
    const product_tags = parseTags(formData.product_tags)
    const style = parseTags(formData.style)

    setSaving(true)

    const payload = {
      // Infos générales
      vertical: formData.vertical.trim() || null,
      external_id: formData.external_id.trim() || null,
      title: formData.title.trim(),
      description: formData.description.trim() || null,
      status: formData.status.trim() || null,
      // Fixed values
      for_sale: true,
      for_rent: false,
      // Médias & URL
      url: formData.url.trim() || null,
      image_url: formData.image_url.trim() || null,
      videos,
      // Prix
      price,
      currency: formData.currency.trim() || null,
      sale_price,
      sale_price_starts_at: formData.sale_price_starts_at || null,
      sale_price_ends_at: formData.sale_price_ends_at || null,
      rental_price,
      booking_mode: formData.booking_mode.trim() || null,
      // Inventaire
      quantity: normalizedInventory.quantity,
      availability: resolvedAvailability,
      condition: formData.condition.trim() || null,
      // Identifiants
      brand: formData.brand.trim() || null,
      gtin: formData.gtin.trim() || null,
      google_product_category: formData.google_product_category.trim() || null,
      fb_product_category: formData.fb_product_category.trim() || null,
      item_group_id: formData.item_group_id.trim() || null,
      // Caractéristiques
      gender: formData.gender.trim() || null,
      color: formData.color.trim() || null,
      size: formData.size.trim() || null,
      age_group: formData.age_group.trim() || null,
      material: formData.material.trim() || null,
      pattern: formData.pattern.trim() || null,
      style,
      // Livraison
      shipping,
      shipping_weight_value,
      shipping_weight_unit: formData.shipping_weight_unit.trim() || null,
      // Offre
      offer_disclaimer: formData.offer_disclaimer.trim() || null,
      offer_disclaimer_url: formData.offer_disclaimer_url.trim() || null,
      // Tags & Attributs
      product_tags,
      attributes,
    }

    if (editingProduit) {
      const { error } = await supabase
        .from('produits')
        .update(payload)
        .eq('id', editingProduit.id)

      if (error) {
        console.error('Update error:', error)
        toast.error('Erreur lors de la modification')
      } else {
        toast.success('Produit modifié avec succès')
        setFormOpen(false)
        fetchProduits()
      }
    } else {
      if (!account?.id) {
        toast.error('Aucun compte actif')
        setSaving(false)
        return
      }
      const { error } = await supabase
        .from('produits')
        .insert({ ...payload, account_id: account.id })

      if (error) {
        console.error('Insert error:', error)
        toast.error('Erreur lors de la création')
      } else {
        toast.success('Produit créé avec succès')
        setFormOpen(false)
        fetchProduits()
      }
    }

    setSaving(false)
  }

  // -------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)

    const { error } = await supabase
      .from('produits')
      .delete()
      .eq('id', deleteTarget.id)

    if (error) {
      console.error('Delete error:', error)
      toast.error('Erreur lors de la suppression')
    } else {
      toast.success('Produit supprimé')
      setDeleteTarget(null)
      fetchProduits()
    }
    setDeleting(false)
  }

  // -------------------------------------------------------------------
  // Pagination helpers
  // -------------------------------------------------------------------

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const canPrev = page > 0
  const canNext = page < totalPages - 1

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Produits</h1>
        </div>
        <Button onClick={openCreateModal} className="gap-2">
          <Plus className="h-4 w-4" />
          Nouveau produit
        </Button>
      </div>

      {/* Search bar */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Rechercher un produit…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-14">Image</TableHead>
              <TableHead>Titre</TableHead>
              <TableHead className="hidden sm:table-cell">Disponibilité</TableHead>
              <TableHead className="text-right">Quantité</TableHead>
              <TableHead className="text-right">Prix</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Chargement…
                  </div>
                </TableCell>
              </TableRow>
            ) : produits.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Package className="h-8 w-8 opacity-40" />
                    {search ? 'Aucun produit trouvé' : 'Aucun produit pour le moment'}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              produits.map((p) => {
                const effectiveAvailability = (p.quantity ?? 0) > 0 ? 'in stock' : 'out of stock'
                const displayPrice = getCurrentDisplayPrice(p)

                return (
                <TableRow key={p.id}>
                  {/* Image */}
                  <TableCell>
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.title ?? 'Produit'}
                        className="h-10 w-10 rounded-md object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                        <Package className="h-5 w-5 text-muted-foreground opacity-50" />
                      </div>
                    )}
                  </TableCell>
                  {/* Title */}
                  <TableCell className="font-medium text-foreground">
                    {p.title || '—'}
                  </TableCell>
                  {/* Availability */}
                  <TableCell className="hidden sm:table-cell">
                    <span
                      className={
                        effectiveAvailability === 'in stock'
                          ? 'inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400'
                          : 'inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400'
                      }
                    >
                      {effectiveAvailability}
                    </span>
                  </TableCell>
                  {/* Quantity */}
                  <TableCell className="text-right tabular-nums">
                    {p.quantity != null ? p.quantity.toLocaleString('fr-FR') : '—'}
                  </TableCell>
                  {/* Current price */}
                  <TableCell className="text-right tabular-nums">
                    {displayPrice != null
                      ? Number(displayPrice).toLocaleString('fr-FR', {
                          style: 'currency',
                          currency: 'EUR',
                          minimumFractionDigits: 2,
                        })
                      : '—'}
                  </TableCell>
                  {/* Actions */}
                  <TableCell>
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
                        <DropdownMenuItem onClick={() => openEditModal(p)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Modifier
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget(p)}
                          className="text-red-400 focus:text-red-400"
                        >
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
        {totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} sur{' '}
              {totalCount}
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

      {/* ----------------------------------------------------------- */}
      {/* Create / Edit Modal                                          */}
      {/* ----------------------------------------------------------- */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {editingProduit ? 'Modifier le produit' : 'Nouveau produit'}
            </DialogTitle>
            <DialogDescription>
              {editingProduit
                ? 'Modifiez les informations du produit.'
                : 'Remplissez les informations pour créer un nouveau produit.'}
            </DialogDescription>
          </DialogHeader>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-1 py-2">
            <div className="flex flex-col gap-6">

              {/* ── Section 1 : Informations générales ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Informations générales</SectionTitle>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-title">Titre *</Label>
                  <Input
                    id="f-title"
                    placeholder="Titre du produit"
                    value={formData.title}
                    onChange={(e) => setField('title', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-description">Description</Label>
                  <textarea
                    id="f-description"
                    rows={3}
                    placeholder="Description du produit"
                    value={formData.description}
                    onChange={(e) => setField('description', e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-vertical">Vertical</Label>
                    <Input
                      id="f-vertical"
                      placeholder="ex: fashion, electronics…"
                      value={formData.vertical}
                      onChange={(e) => setField('vertical', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-status">Statut</Label>
                    <Input
                      id="f-status"
                      placeholder="ex: active, draft…"
                      value={formData.status}
                      onChange={(e) => setField('status', e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-external-id">ID externe</Label>
                  <Input
                    id="f-external-id"
                    placeholder="Référence externe"
                    value={formData.external_id}
                    onChange={(e) => setField('external_id', e.target.value)}
                  />
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 2 : Médias & URL ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Médias &amp; URL</SectionTitle>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-image-url">URL de l'image</Label>
                  <Input
                    id="f-image-url"
                    placeholder="https://…"
                    value={formData.image_url}
                    onChange={(e) => setField('image_url', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-url">URL du produit</Label>
                  <Input
                    id="f-url"
                    placeholder="https://…"
                    value={formData.url}
                    onChange={(e) => setField('url', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-videos">
                    Vidéos{' '}
                    <span className="text-xs text-muted-foreground">(JSON)</span>
                  </Label>
                  <textarea
                    id="f-videos"
                    rows={2}
                    placeholder='[{"url":"https://…"}]'
                    value={formData.videos}
                    onChange={(e) => setField('videos', e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  />
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 3 : Prix ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Prix</SectionTitle>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-price">Prix</Label>
                    <Input
                      id="f-price"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.price}
                      onChange={(e) => setField('price', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-currency">Devise</Label>
                    <Input
                      id="f-currency"
                      placeholder="EUR, USD…"
                      value={formData.currency}
                      onChange={(e) => setField('currency', e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-sale-price">Prix soldé</Label>
                    <Input
                      id="f-sale-price"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.sale_price}
                      onChange={(e) => setField('sale_price', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-rental-price">Prix de location</Label>
                    <Input
                      id="f-rental-price"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.rental_price}
                      onChange={(e) => setField('rental_price', e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-sale-starts">Début promo</Label>
                    <Input
                      id="f-sale-starts"
                      type="datetime-local"
                      value={formData.sale_price_starts_at}
                      onChange={(e) => setField('sale_price_starts_at', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-sale-ends">Fin promo</Label>
                    <Input
                      id="f-sale-ends"
                      type="datetime-local"
                      value={formData.sale_price_ends_at}
                      onChange={(e) => setField('sale_price_ends_at', e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-booking-mode">Mode de réservation</Label>
                  <Input
                    id="f-booking-mode"
                    placeholder="ex: instant, request…"
                    value={formData.booking_mode}
                    onChange={(e) => setField('booking_mode', e.target.value)}
                  />
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 4 : Inventaire ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Inventaire</SectionTitle>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-quantity">Quantité</Label>
                    <Input
                      id="f-quantity"
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      value={formData.quantity}
                      onChange={(e) => setField('quantity', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-availability">Disponibilité</Label>
                    <Input
                      id="f-availability"
                      placeholder="in stock / out of stock…"
                      value={formData.availability}
                      onChange={(e) => setField('availability', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-condition">État</Label>
                    <Input
                      id="f-condition"
                      placeholder="new, used, refurbished…"
                      value={formData.condition}
                      onChange={(e) => setField('condition', e.target.value)}
                    />
                  </div>
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 5 : Identifiants produit ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Identifiants produit</SectionTitle>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-brand">Marque</Label>
                    <Input
                      id="f-brand"
                      placeholder="Marque"
                      value={formData.brand}
                      onChange={(e) => setField('brand', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-gtin">GTIN</Label>
                    <Input
                      id="f-gtin"
                      placeholder="Code-barres EAN/UPC…"
                      value={formData.gtin}
                      onChange={(e) => setField('gtin', e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-gpc">Catégorie Google</Label>
                      <div className="flex flex-col gap-1">
                          {/* Niveau 1 */}
                        <select
                          value={gpcLevel1}
                          onChange={(e) => { setGpcLevel1(e.target.value); setGpcLevel2(''); }}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {gpcLevel1Options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                        {/* Niveau 2 */}
                      {gpcLevel1 && (
                        <select
                          value={gpcLevel2}
                          onChange={(e) => setGpcLevel2(e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {gpcLevel2Options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      )}
                        {/* Niveau 3 */}
                      {gpcLevel2 && (
                        <select
                          value={formData.google_product_category}
                          onChange={(e) => {
                            const selected = gpcLevel3Options.find(opt => opt.full_path === e.target.value)
                            setField('google_product_category', selected?.label ?? e.target.value)
                          }}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {gpcLevel3Options.map((opt) => (
                            <option key={opt.full_path} value={opt.full_path}>{opt.label}</option>
                          ))}
                        </select>
                      )}
                      {/* Valeur finale sélectionnée */}
                      {formData.google_product_category && (
                        <p className="text-xs text-muted-foreground">{formData.google_product_category}</p>
                      )}
                      </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-fpc">Catégorie Facebook</Label>
                      <div className="flex flex-col gap-1">
                          {/* Niveau 1 */}
                        <select
                          value={fbpcLevel1}
                          onChange={(e) => { setFbpcLevel1(e.target.value); setFbpcLevel2(''); }}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          
                          {fbpcLevel1Options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                        {/* Niveau 2 */}
                      {fbpcLevel1 && (
                        <select
                          value={fbpcLevel2}
                          onChange={(e) => setFbpcLevel2(e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          
                          {fbpcLevel2Options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      )}
                        {/* Niveau 3 */}
                      {fbpcLevel2 && (
                        <select
                          value={formData.fb_product_category}
                          onChange={(e) => {
                            const selected = fbpcLevel3Options.find(opt => opt.full_path === e.target.value)
                            setField('fb_product_category', selected?.label ?? e.target.value)
                          }}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          
                          {fbpcLevel3Options.map((opt) => (
                            <option key={opt.full_path} value={opt.full_path}>{opt.label}</option>
                          ))}
                        </select>
                      )}
                      {/* Valeur finale sélectionnée */}
                      {formData.fb_product_category && (
                        <p className="text-xs text-muted-foreground">{formData.fb_product_category}</p>
                      )}
                      </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-item-group">ID groupe d'articles</Label>
                  <Input
                    id="f-item-group"
                    placeholder="item_group_id"
                    value={formData.item_group_id}
                    onChange={(e) => setField('item_group_id', e.target.value)}
                  />
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 6 : Caractéristiques ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Caractéristiques</SectionTitle>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-gender">Genre</Label>
                    <Input
                      id="f-gender"
                      placeholder="male, female, unisex…"
                      value={formData.gender}
                      onChange={(e) => setField('gender', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-age-group">Groupe d'âge</Label>
                    <Input
                      id="f-age-group"
                      placeholder="adult, kids…"
                      value={formData.age_group}
                      onChange={(e) => setField('age_group', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-size">Taille</Label>
                    <Input
                      id="f-size"
                      placeholder="S, M, L, XL…"
                      value={formData.size}
                      onChange={(e) => setField('size', e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-color">Couleur</Label>
                    <Input
                      id="f-color"
                      placeholder="Rouge, Bleu…"
                      value={formData.color}
                      onChange={(e) => setField('color', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-material">Matière</Label>
                    <Input
                      id="f-material"
                      placeholder="Coton, Cuir…"
                      value={formData.material}
                      onChange={(e) => setField('material', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-pattern">Motif</Label>
                    <Input
                      id="f-pattern"
                      placeholder="Rayures, Uni…"
                      value={formData.pattern}
                      onChange={(e) => setField('pattern', e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-style">
                    Styles{' '}
                    <span className="text-xs text-muted-foreground">(séparés par des virgules)</span>
                  </Label>
                  <Input
                    id="f-style"
                    placeholder="casual, sport, formal"
                    value={formData.style}
                    onChange={(e) => setField('style', e.target.value)}
                  />
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 7 : Livraison ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Livraison</SectionTitle>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-shipping">
                    Livraison{' '}
                    <span className="text-xs text-muted-foreground">(JSON)</span>
                  </Label>
                  <textarea
                    id="f-shipping"
                    rows={2}
                    placeholder='{"country":"FR","price":5.99}'
                    value={formData.shipping}
                    onChange={(e) => setField('shipping', e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-sw-value">Poids (valeur)</Label>
                    <Input
                      id="f-sw-value"
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="0.000"
                      value={formData.shipping_weight_value}
                      onChange={(e) => setField('shipping_weight_value', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-sw-unit">Poids (unité)</Label>
                    <Input
                      id="f-sw-unit"
                      placeholder="kg, g, lb…"
                      value={formData.shipping_weight_unit}
                      onChange={(e) => setField('shipping_weight_unit', e.target.value)}
                    />
                  </div>
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 8 : Offre ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Offre</SectionTitle>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-disclaimer">Mention légale de l'offre</Label>
                  <Input
                    id="f-disclaimer"
                    placeholder="Texte de mention…"
                    value={formData.offer_disclaimer}
                    onChange={(e) => setField('offer_disclaimer', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-disclaimer-url">URL de la mention</Label>
                  <Input
                    id="f-disclaimer-url"
                    placeholder="https://…"
                    value={formData.offer_disclaimer_url}
                    onChange={(e) => setField('offer_disclaimer_url', e.target.value)}
                  />
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 9 : Tags & Attributs ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Tags &amp; Attributs</SectionTitle>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-tags">
                    Tags produit{' '}
                    <span className="text-xs text-muted-foreground">(séparés par des virgules)</span>
                  </Label>
                  <Input
                    id="f-tags"
                    placeholder="promo, nouveauté, bestseller"
                    value={formData.product_tags}
                    onChange={(e) => setField('product_tags', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-attributes">
                    Attributs{' '}
                    <span className="text-xs text-muted-foreground">(JSON)</span>
                  </Label>
                  <textarea
                    id="f-attributes"
                    rows={3}
                    placeholder='{"custom_key":"value"}'
                    value={formData.attributes}
                    onChange={(e) => setField('attributes', e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  />
                </div>
              </section>

            </div>
          </div>

          {/* Footer */}
          <DialogFooter className="shrink-0 border-t border-border pt-4">
            <Button
              variant="outline"
              onClick={() => setFormOpen(false)}
              disabled={saving}
            >
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingProduit ? 'Enregistrer' : 'Créer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------- */}
      {/* Delete Confirmation Modal                                    */}
      {/* ----------------------------------------------------------- */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Supprimer le produit</DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir supprimer{' '}
              <strong className="text-foreground">{deleteTarget?.title ?? 'ce produit'}</strong> ?
              Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="gap-2"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
