'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, Pencil, ToggleLeft, ToggleRight, Wrench } from 'lucide-react'

interface ServiceRecord {
  id: string
  title: string | null
  vertical: string | null
  price: number | null
  is_active?: boolean | null
  active?: boolean | null
  status?: string | null
}

interface ServiceFormState {
  title: string
  vertical: string
  price: string
}

const EMPTY_FORM: ServiceFormState = {
  title: '',
  vertical: '',
  price: '',
}

function fmtCurrency(value: number | null) {
  if (value == null) return '—'
  return value.toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  })
}

function getActiveValue(service: ServiceRecord) {
  if (typeof service.is_active === 'boolean') return service.is_active
  if (typeof service.active === 'boolean') return service.active

  const status = (service.status ?? '').toString().trim().toLowerCase()
  if (status === 'active' || status === 'enabled' || status === 'true' || status === '1') {
    return true
  }
  if (status === 'inactive' || status === 'disabled' || status === 'false' || status === '0') {
    return false
  }

  return true
}

function getUpdatePayloadForActivation(service: ServiceRecord, active: boolean) {
  if ('is_active' in service) {
    return { is_active: active }
  }
  if ('active' in service) {
    return { active }
  }
  return { status: active ? 'active' : 'inactive' }
}

export default function ServicesPage() {
  const supabase = createClient()
  const [services, setServices] = useState<ServiceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingService, setEditingService] = useState<ServiceRecord | null>(null)
  const [formData, setFormData] = useState<ServiceFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const fetchServices = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('services').select('*').order('vertical', { ascending: true }).order('title', { ascending: true })

    if (error) {
      console.error('Failed to fetch services:', error)
      toast.error('Erreur lors du chargement des services')
      setLoading(false)
      return
    }

    setServices((data ?? []) as ServiceRecord[])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    void fetchServices()
  }, [fetchServices])

  function openEditModal(service: ServiceRecord) {
    setEditingService(service)
    setFormData({
      title: service.title ?? '',
      vertical: service.vertical ?? '',
      price: service.price != null ? String(service.price) : '',
    })
    setFormOpen(true)
  }

  async function handleSave() {
    if (!editingService) return

    const price = Number(formData.price)
    if (!Number.isFinite(price)) {
      toast.error('Le prix doit être un nombre valide')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase
        .from('services')
        .update({
          title: formData.title.trim() || null,
          vertical: formData.vertical.trim() || null,
          price,
        })
        .eq('id', editingService.id)

      if (error) throw error

      toast.success('Service mis à jour')
      setFormOpen(false)
      setEditingService(null)
      setFormData(EMPTY_FORM)
      await fetchServices()
    } catch (error: any) {
      console.error('Service save error:', error)
      toast.error(error?.message || 'Erreur lors de la mise à jour du service')
    } finally {
      setSaving(false)
    }
  }

  async function toggleService(service: ServiceRecord) {
    const nextValue = !getActiveValue(service)
    setTogglingId(service.id)

    try {
      const { error } = await supabase
        .from('services')
        .update(getUpdatePayloadForActivation(service, nextValue))
        .eq('id', service.id)

      if (error) throw error

      toast.success(nextValue ? 'Service activé' : 'Service désactivé')
      await fetchServices()
    } catch (error: any) {
      console.error('Service toggle error:', error)
      toast.error(error?.message || 'Erreur lors du changement de statut')
    } finally {
      setTogglingId(null)
    }
  }

  const groupedServices = services.reduce<Record<string, ServiceRecord[]>>((acc, service) => {
    const vertical = (service.vertical ?? '').toString().trim() || 'Autre'
    if (!acc[vertical]) acc[vertical] = []
    acc[vertical].push(service)
    return acc
  }, {})

  return (
    <div className="flex flex-col space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Services</h1>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement des services…
          </div>
        </div>
      ) : services.length === 0 ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-8 text-center text-muted-foreground">
          <Wrench className="mb-3 h-8 w-8 opacity-50" />
          <p>Aucun service disponible pour le moment.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(groupedServices).map(([vertical, items]) => (
            <div key={vertical} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-4 border-b border-border pb-3">
                <h2 className="text-lg font-semibold text-foreground">{vertical}</h2>
                <p className="text-sm text-muted-foreground">{items.length} service{items.length > 1 ? 's' : ''}</p>
              </div>

              <div className="space-y-3">
                {items.map((service) => {
                  const active = getActiveValue(service)
                  return (
                    <div key={service.id} className="rounded-lg border border-border/70 bg-background/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">{service.title || 'Sans titre'}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{fmtCurrency(service.price)}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openEditModal(service)}
                            className="gap-2"
                          >
                            <Pencil className="h-4 w-4" />
                            Modifier
                          </Button>

                          <Button
                            type="button"
                            variant={active ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => void toggleService(service)}
                            disabled={togglingId === service.id}
                            className="gap-2"
                          >
                            {togglingId === service.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : active ? (
                              <ToggleRight className="h-4 w-4" />
                            ) : (
                              <ToggleLeft className="h-4 w-4" />
                            )}
                            {active ? 'Activé' : 'Désactivé'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Modifier le service</DialogTitle>
            <DialogDescription>Modifiez le nom, la vertical et le prix du service.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="service-title">Titre</Label>
              <Input
                id="service-title"
                value={formData.title}
                onChange={(event) => setFormData((current) => ({ ...current, title: event.target.value }))}
                placeholder="Nom du service"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-vertical">Vertical</Label>
              <Input
                id="service-vertical"
                value={formData.vertical}
                onChange={(event) => setFormData((current) => ({ ...current, vertical: event.target.value }))}
                placeholder="Ex. Santé"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-price">Prix</Label>
              <Input
                id="service-price"
                type="number"
                min="0"
                step="0.01"
                value={formData.price}
                onChange={(event) => setFormData((current) => ({ ...current, price: event.target.value }))}
                placeholder="0"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Annuler
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
