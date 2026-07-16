'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
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
  account_id: string
  name: string
  description: string | null
  price: number
  stock: number
  created_at: string
  updated_at: string
}

interface ProduitFormData {
  name: string
  description: string
  price: string
  stock: string
}

const EMPTY_FORM: ProduitFormData = { name: '', description: '', price: '', stock: '' }
const PAGE_SIZE = 25

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

  // -------------------------------------------------------------------
  // Fetch
  // -------------------------------------------------------------------

  const fetchProduits = useCallback(async () => {
    setLoading(true)
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabase
      .from('produits')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (search.trim()) {
      query = query.ilike('name', `%${search.trim()}%`)
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

  // Reset to first page when search changes
  useEffect(() => {
    setPage(0)
  }, [search])

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
    setFormData({
      name: produit.name,
      description: produit.description ?? '',
      price: String(produit.price),
      stock: String(produit.stock),
    })
    setFormOpen(true)
  }

  async function handleSave() {
    if (!formData.name.trim()) {
      toast.error('Le nom du produit est requis')
      return
    }

    const price = parseFloat(formData.price)
    const stock = parseInt(formData.stock, 10)

    if (isNaN(price) || price < 0) {
      toast.error('Le prix doit être un nombre positif')
      return
    }
    if (isNaN(stock) || stock < 0) {
      toast.error('Le stock doit être un nombre entier positif')
      return
    }

    setSaving(true)

    const payload = {
      name: formData.name.trim(),
      description: formData.description.trim() || null,
      price,
      stock,
    }

    if (editingProduit) {
      // Update
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
      // Create
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
          <p className="mt-1 text-sm text-muted-foreground">
            Gérez votre catalogue de produits.
          </p>
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
              <TableHead>Nom</TableHead>
              <TableHead className="hidden sm:table-cell">Description</TableHead>
              <TableHead className="text-right">Prix</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="hidden md:table-cell">Créé le</TableHead>
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
              produits.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-foreground">
                    {p.name}
                  </TableCell>
                  <TableCell className="hidden max-w-xs truncate text-muted-foreground sm:table-cell">
                    {p.description || '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(p.price).toLocaleString('fr-FR', {
                      style: 'currency',
                      currency: 'MGA',
                    })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.stock.toLocaleString()}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {new Date(p.created_at).toLocaleDateString('fr-FR')}
                  </TableCell>
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
              ))
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingProduit ? 'Modifier le produit' : 'Nouveau produit'}
            </DialogTitle>
            <DialogDescription>
              {editingProduit
                ? 'Modifiez les informations du produit.'
                : 'Remplissez les informations pour créer un nouveau produit.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="prod-name">Nom *</Label>
              <Input
                id="prod-name"
                placeholder="Nom du produit"
                value={formData.name}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="prod-desc">Description</Label>
              <Input
                id="prod-desc"
                placeholder="Description (optionnel)"
                value={formData.description}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="prod-price">Prix</Label>
                <Input
                  id="prod-price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.price}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, price: e.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="prod-stock">Stock</Label>
                <Input
                  id="prod-stock"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={formData.stock}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, stock: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
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
              <strong className="text-foreground">{deleteTarget?.name}</strong> ?
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
