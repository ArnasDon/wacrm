'use client'

// ============================================================
// AppointmentDialog — crear / editar / reschedule / cancelar cita.
//
// Un solo dialog sin wizard. Campos: contacto (búsqueda vía supabase
// browser client + RLS, mismo patrón que /contacts), doctor (members),
// sala (resources), fechas inicio/fin (inputs nativos datetime-local),
// status (transición rápida) y notas.
//
// Tenancy del lado del cliente: el browser client tiene RLS, el server
// re-valida account_id en cada PATCH/POST.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import type { Contact } from '@/types'
import type { CalendarAppointment, CalendarMember, CalendarResource } from './appointments-page'

type Status = CalendarAppointment['status']

const STATUS_OPTIONS: Status[] = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']

function toLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AppointmentDialog({
  open,
  onOpenChange,
  editing,
  members,
  resources,
  defaultUserId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: CalendarAppointment | null
  members: CalendarMember[]
  resources: CalendarResource[]
  defaultUserId: string
  onSaved: () => void
}) {
  const supabase = createClient()

  const [contactQuery, setContactQuery] = useState('')
  const [contactResults, setContactResults] = useState<Contact[]>([])
  const [searching, setSearching] = useState(false)
  const [contactId, setContactId] = useState<string>('')
  const [contactLabel, setContactLabel] = useState<string>('')
  const [assignedUserId, setAssignedUserId] = useState<string>(defaultUserId)
  const [resourceId, setResourceId] = useState<string>('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [status, setStatus] = useState<Status>('scheduled')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset del formulario cada vez que se abre (nuevo o edición).
  useEffect(() => {
    if (!open) return
    setError(null)
    setContactQuery('')
    setContactResults([])
    if (editing) {
      setContactId(editing.contact_id)
      setContactLabel(editing.contact_name ?? 'Contact')
      setAssignedUserId(editing.assigned_user_id)
      setResourceId(editing.resource_id ?? '')
      setStartAt(toLocalInput(editing.start_at))
      setEndAt(toLocalInput(editing.end_at))
      setStatus(editing.status)
      setNotes(editing.notes ?? '')
    } else {
      setContactId('')
      setContactLabel('')
      setAssignedUserId(defaultUserId)
      setResourceId('')
      setStartAt('')
      setEndAt('')
      setStatus('scheduled')
      setNotes('')
    }
  }, [open, editing, defaultUserId])

  const searchContacts = useCallback(
    async (term: string) => {
      setSearching(true)
      try {
        let query = supabase
          .from('contacts')
          .select('id, name, phone, email')
          .order('created_at', { ascending: false })
          .limit(8)
        if (term.trim()) {
          const like = `%${term.trim()}%`
          query = query.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
        }
        const { data, error } = await query
        if (error) throw error
        setContactResults((data ?? []) as Contact[])
      } catch (err) {
        console.error('[appointments] contact search failed:', err)
        setContactResults([])
      } finally {
        setSearching(false)
      }
    },
    [supabase],
  )

  useEffect(() => {
    if (!open || editing) return
    const t = setTimeout(() => void searchContacts(contactQuery), 250)
    return () => clearTimeout(t)
  }, [open, editing, contactQuery, searchContacts])

  const memberName = useMemo(
    () => members.find((m) => m.user_id === assignedUserId)?.full_name ?? 'Doctor',
    [members, assignedUserId],
  )

  const save = useCallback(async () => {
    if (!contactId) {
      setError('Select a contact')
      return
    }
    if (!startAt || !endAt) {
      setError('Start and end are required')
      return
    }
    if (new Date(endAt) <= new Date(startAt)) {
      setError('End must be after start')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        contact_id: contactId,
        assigned_user_id: assignedUserId,
        resource_id: resourceId || null,
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(endAt).toISOString(),
        notes: notes.trim() || null,
      }
      const res = await fetch(
        editing ? `/api/appointments/${editing.id}` : '/api/appointments',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Failed to save')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      console.error('[appointments] save failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [contactId, startAt, endAt, assignedUserId, resourceId, notes, editing, onSaved, onOpenChange])

  const transitionStatus = useCallback(
    async (next: Status) => {
      if (!editing || next === editing.status) return
      setSaving(true)
      setError(null)
      try {
        const res = await fetch(`/api/appointments/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: next }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error ?? 'Failed to update status')
        onSaved()
        onOpenChange(false)
      } catch (err) {
        console.error('[appointments] status transition failed:', err)
        setError(err instanceof Error ? err.message : 'Failed to update status')
      } finally {
        setSaving(false)
      }
    },
    [editing, onSaved, onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit appointment' : 'New appointment'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Contacto — búsqueda */}
          <div>
            <Label>Contact</Label>
            {!editing ? (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search by name, phone or email…"
                    value={contactQuery}
                    onChange={(e) => setContactQuery(e.target.value)}
                  />
                </div>
                {searching && (
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                  </div>
                )}
                <div className="mt-1 max-h-40 space-y-1 overflow-auto">
                  {contactResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setContactId(c.id)
                        setContactLabel(c.name ?? c.phone ?? 'Contact')
                        setContactResults([])
                      }}
                      className="block w-full rounded-md border border-border px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      <span className="font-medium">{c.name ?? 'Unnamed'}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{c.phone ?? c.email ?? ''}</span>
                    </button>
                  ))}
                  {!searching && contactResults.length === 0 && contactQuery.length > 0 && (
                    <div className="px-1 text-xs text-muted-foreground">No contacts found</div>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm">{contactLabel}</div>
            )}
          </div>

          {/* Doctor y sala */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Doctor</Label>
              <select
                value={assignedUserId}
                onChange={(e) => setAssignedUserId(e.target.value)}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm"
              >
                {members.length === 0 && <option value={assignedUserId}>{memberName}</option>}
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Room</Label>
              <select
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm"
              >
                <option value="">No room</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start</Label>
              <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div>
              <Label>End</Label>
              <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </div>
          </div>

          {/* Notas */}
          <div>
            <Label>Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes…"
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm"
            />
          </div>

          {/* Transición rápida de status (solo edición) */}
          {editing && (
            <div>
              <Label>Status</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.filter((s) => s !== editing.status).map((s) => (
                  <Button key={s} type="button" variant="outline" size="sm" onClick={() => void transitionStatus(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {!editing && (
              <Button type="button" onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Create
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}