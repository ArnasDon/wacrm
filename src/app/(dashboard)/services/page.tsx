'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
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
import { Clock, Loader2, Pencil, Plus, ToggleLeft, ToggleRight, Wrench } from 'lucide-react'

interface ServiceRecord {
  id: string
  vertical: string | null
  booking_mode?: string | null
  title: string | null
  description?: string | null
  price: number | null
  currency?: string | null
  image_url?: string | null
  attributes?: Record<string, unknown> | string | null
  status?: string | null
  created_at?: string | null
  cal_event_slug?: string | null
  cal_username?: string | null
  is_active?: boolean | null
  active?: boolean | null
}

interface ServiceFormState {
  vertical: string
  booking_mode: string
  title: string
  description: string
  price: string
  currency: string
  image_url: string
  attributes: string
  status: string
  cal_event_slug: string
  cal_username: string
}

const EMPTY_FORM: ServiceFormState = {
  vertical: '',
  booking_mode: 'appointment',
  title: '',
  description: '',
  price: '',
  currency: 'EUR',
  image_url: '',
  attributes: '',
  status: 'active',
  cal_event_slug: '',
  cal_username: '',
}

function fmtCurrency(value: number | null) {
  if (value == null) return '—'
  return value.toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  })
}

function getServiceDuration(attributes: unknown): string | null {
  if (!attributes) return null
  let parsed = attributes
  if (typeof attributes === 'string') {
    try {
      parsed = JSON.parse(attributes)
    } catch {
      return null
    }
  }
  if (typeof parsed === 'object' && parsed !== null && 'duration' in parsed) {
    const val = (parsed as Record<string, unknown>).duration
    if (val != null && String(val).trim()) {
      return String(val).trim()
    }
  }
  return null
}

function normalizeAttributes(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
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
  const { accountId } = useAuth()
  const [services, setServices] = useState<ServiceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingService, setEditingService] = useState<ServiceRecord | null>(null)
  const [formData, setFormData] = useState<ServiceFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const fetchServices = useCallback(async () => {
    if (!accountId) {
      setServices([])
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('account_id', accountId)
      .order('vertical', { ascending: true })
      .order('title', { ascending: true })

    if (error) {
      console.error('Failed to fetch services:', error)
      toast.error('Erreur lors du chargement des services')
      setLoading(false)
      return
    }

    setServices((data ?? []) as ServiceRecord[])
    setLoading(false)
  }, [accountId, supabase])

  useEffect(() => {
    void fetchServices()
  }, [fetchServices])

  function openCreateModal() {
    setEditingService(null)
    setFormData(EMPTY_FORM)
    setFormOpen(true)
  }

  function openEditModal(service: ServiceRecord) {
    setEditingService(service)
    setFormData({
      vertical: service.vertical ?? '',
      booking_mode: service.booking_mode ?? 'appointment',
      title: service.title ?? '',
      description: service.description ?? '',
      price: service.price != null ? String(service.price) : '',
      currency: service.currency ?? 'EUR',
      image_url: service.image_url ?? '',
      attributes: typeof service.attributes === 'string' ? service.attributes : service.attributes ? JSON.stringify(service.attributes, null, 2) : '',
      status: service.status ?? 'active',
      cal_event_slug: service.cal_event_slug ?? '',
      cal_username: service.cal_username ?? '',
    })
    setFormOpen(true)
  }

  async function handleSave() {
    const title = formData.title.trim()
    const vertical = formData.vertical.trim()
    const price = Number(formData.price)

    if (!accountId) {
      toast.error('Aucun compte actif')
      return
    }

    if (!title) {
      toast.error('Le titre du service est requis')
      return
    }

    if (!vertical) {
      toast.error('La vertical est requise')
      return
    }

    if (!Number.isFinite(price)) {
      toast.error('Le prix doit être un nombre valide')
      return
    }

    setSaving(true)
    try {
      const payload = {
        account_id: accountId,
        vertical: vertical || null,
        booking_mode: formData.booking_mode.trim() || null,
        title: title || null,
        description: formData.description.trim() || null,
        price,
        currency: formData.currency.trim() || 'EUR',
        image_url: formData.image_url.trim() || null,
        attributes: normalizeAttributes(formData.attributes),
        status: formData.status.trim() || 'active',
        cal_event_slug: formData.cal_event_slug.trim() || null,
        cal_username: formData.cal_username.trim() || null,
        ...(editingService ? {} : { created_at: new Date().toISOString() }),
      }

      const { error } = editingService
        ? await supabase
            .from('services')
            .update(payload)
            .eq('id', editingService.id)
            .eq('account_id', accountId)
        : await supabase.from('services').insert([payload])

      if (error) throw error

      toast.success(editingService ? 'Service mis à jour' : 'Service ajouté')
      setFormOpen(false)
      setEditingService(null)
      setFormData(EMPTY_FORM)
      await fetchServices()
    } catch (error: any) {
      console.error('Service save error:', error)
      toast.error(error?.message || (editingService ? 'Erreur lors de la mise à jour du service' : 'Erreur lors de l’ajout du service'))
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

  const verticalOptions = Array.from(
    new Set(services.map((service) => service.vertical).filter((value): value is string => Boolean(value && value.trim()))),
  ).sort((a, b) => a.localeCompare(b))

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
        <Button type="button" onClick={openCreateModal} className="gap-2">
          <Plus className="h-4 w-4" />
          Ajouter un service
        </Button>
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
                  const duration = getServiceDuration(service.attributes)
                  return (
                    <div key={service.id} className="rounded-lg border border-border/70 bg-background/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">{service.title || 'Sans titre'}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                            <span>{fmtCurrency(service.price)}</span>
                            {duration && (
                              <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-medium text-foreground/80">
                                <Clock className="h-3 w-3 text-muted-foreground" />
                                {duration.includes('min') || duration.includes('h') ? duration : `${duration} min`}
                              </span>
                            )}
                          </div>
                          {service.description && (
                            <p className="mt-1 text-xs text-muted-foreground line-clamp-1">{service.description}</p>
                          )}
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingService ? 'Modifier le service' : 'Ajouter un service'}</DialogTitle>
            <DialogDescription>
              {editingService
                ? 'Modifiez les informations du service. Le champ date de création est géré automatiquement.'
                : 'Remplissez uniquement les champs utiles. La date de création est ajoutée automatiquement.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="service-vertical">Vertical</Label>
              <Input
                id="service-vertical"
                list="service-vertical-options"
                value={formData.vertical}
                onChange={(event) => setFormData((current) => ({ ...current, vertical: event.target.value }))}
                placeholder="Ex. Santé"
              />
              <datalist id="service-vertical-options">
                {verticalOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </div>

            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="service-booking-mode">Booking mode</Label>
              <Input
                id="service-booking-mode"
                value={formData.booking_mode}
                onChange={(event) => setFormData((current) => ({ ...current, booking_mode: event.target.value }))}
                placeholder="appointment"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="service-title">Titre</Label>
              <Input
                id="service-title"
                value={formData.title}
                onChange={(event) => setFormData((current) => ({ ...current, title: event.target.value }))}
                placeholder="Nom du service"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="service-description">Description</Label>
              <textarea
                id="service-description"
                value={formData.description}
                onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
                placeholder="Décrivez le service"
                className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            <div className="space-y-2 md:col-span-1">
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

            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="service-currency">Devise</Label>
              <Input
                id="service-currency"
                value={formData.currency}
                onChange={(event) => setFormData((current) => ({ ...current, currency: event.target.value }))}
                placeholder="EUR"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="service-image">Image URL</Label>
              <Input
                id="service-image"
                value={formData.image_url}
                onChange={(event) => setFormData((current) => ({ ...current, image_url: event.target.value }))}
                placeholder="https://..."
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="service-attributes">Attributes</Label>
              <textarea
                id="service-attributes"
                value={formData.attributes}
                onChange={(event) => setFormData((current) => ({ ...current, attributes: event.target.value }))}
                placeholder='{"duration": "30 min"}'
                className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="service-status">Status</Label>
              <Input
                id="service-status"
                value={formData.status}
                onChange={(event) => setFormData((current) => ({ ...current, status: event.target.value }))}
                placeholder="active"
              />
            </div>

            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="service-cal-event">Cal event slug</Label>
              <Input
                id="service-cal-event"
                value={formData.cal_event_slug}
                onChange={(event) => setFormData((current) => ({ ...current, cal_event_slug: event.target.value }))}
                placeholder="service-slug"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="service-cal-username">Cal username</Label>
              <Input
                id="service-cal-username"
                value={formData.cal_username}
                onChange={(event) => setFormData((current) => ({ ...current, cal_username: event.target.value }))}
                placeholder="your-calendar-username"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Annuler
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Enregistrement…' : editingService ? 'Enregistrer' : 'Créer le service'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
