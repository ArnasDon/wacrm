'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslations } from 'next-intl';
import type { Appointment, AppointmentType, Contact, Property } from '@/types';
import { createAppointment, updateAppointment } from '@/lib/appointments/queries';
import { createProperty, listProperties } from '@/lib/properties/queries';
import { localDayKey } from '@/lib/dashboard/date-utils';

const APPOINTMENT_TYPES: AppointmentType[] = [
  'call',
  'visit',
  'meeting',
  'proposal',
  'follow_up',
  'other',
];

interface AppointmentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing appointment; omit/null to create a new one. */
  appointment?: Appointment | null;
  /** Pre-fills the date field — the dashboard always creates for today. */
  defaultDate?: string;
  onSaved: () => void;
}

export function AppointmentFormDialog({
  open,
  onOpenChange,
  appointment,
  defaultDate,
  onSaved,
}: AppointmentFormDialogProps) {
  const t = useTranslations('Appointments.form');
  const tAppt = useTranslations('Appointments');
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [type, setType] = useState<AppointmentType>('call');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [addingProperty, setAddingProperty] = useState(false);
  const [newPropertyName, setNewPropertyName] = useState('');
  const [creatingProperty, setCreatingProperty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset on open — a legitimate prop-driven sync, same rationale as
  // deal-form.tsx.
  useEffect(() => {
    if (!open) return;
    if (appointment) {
      setTitle(appointment.title);
      setContactId(appointment.contact_id ?? '');
      setPropertyId(appointment.property_id ?? '');
      setDate(appointment.scheduled_date);
      setTime(appointment.scheduled_time?.slice(0, 5) ?? '');
      setEndTime(appointment.scheduled_end_time?.slice(0, 5) ?? '');
      setType(appointment.type);
      setDescription(appointment.description ?? '');
      setNotes(appointment.notes ?? '');
    } else {
      setTitle('');
      setContactId('');
      setPropertyId('');
      setDate(defaultDate ?? localDayKey(new Date()));
      setTime('');
      setEndTime('');
      setType('call');
      setDescription('');
      setNotes('');
    }
    setAddingProperty(false);
    setNewPropertyName('');
  }, [open, appointment, defaultDate]);

  useEffect(() => {
    if (!open) return;
    supabase
      .from('contacts')
      .select('*')
      .order('name')
      .then(({ data }) => setContacts((data ?? []) as Contact[]));
    listProperties(supabase).then(setProperties);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleCreateProperty() {
    const name = newPropertyName.trim();
    if (!name || !user || !accountId) return;
    setCreatingProperty(true);
    try {
      const property = await createProperty(supabase, { accountId, userId: user.id, name });
      setProperties((prev) => [...prev, property].sort((a, b) => a.name.localeCompare(b.name)));
      setPropertyId(property.id);
      setAddingProperty(false);
      setNewPropertyName('');
    } catch (err) {
      console.error('Failed to create property:', err);
      toast.error(t('toastPropertyCreateFailed'));
    } finally {
      setCreatingProperty(false);
    }
  }

  async function handleSave() {
    if (!title.trim()) {
      toast.error(t('titleRequired'));
      return;
    }
    if (!date) {
      toast.error(t('dateRequired'));
      return;
    }
    if (endTime && !time) {
      toast.error(t('endTimeNeedsStart'));
      return;
    }
    if (endTime && time && endTime <= time) {
      toast.error(t('endTimeBeforeStart'));
      return;
    }
    if (!user || !accountId) {
      toast.error(t('notAuthenticated'));
      return;
    }

    setSaving(true);
    try {
      const input = {
        accountId,
        userId: user.id,
        title: title.trim(),
        description: description.trim() || null,
        notes: notes.trim() || null,
        type,
        scheduledDate: date,
        scheduledTime: time || null,
        scheduledEndTime: endTime || null,
        contactId: contactId || null,
        propertyId: propertyId || null,
      };
      if (appointment) {
        await updateAppointment(supabase, appointment.id, input);
        toast.success(t('toastUpdated'));
      } else {
        await createAppointment(supabase, input);
        toast.success(t('toastCreated'));
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error('Failed to save appointment:', err);
      toast.error(t('toastSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{appointment ? t('editTitle') : t('newTitle')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground">{t('titleLabel')}</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('titlePlaceholder')}
              disabled={saving}
              maxLength={120}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground">{t('contactLabel')}</label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              disabled={saving}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="">{tAppt('noContact')}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.phone}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground">{t('propertyLabel')}</label>
            {addingProperty ? (
              <div className="flex gap-2">
                <Input
                  value={newPropertyName}
                  onChange={(e) => setNewPropertyName(e.target.value)}
                  placeholder={t('propertyNamePlaceholder')}
                  disabled={creatingProperty}
                  maxLength={120}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCreateProperty();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCreateProperty}
                  disabled={creatingProperty || !newPropertyName.trim()}
                >
                  {creatingProperty ? <Loader2 className="size-4 animate-spin" /> : t('add')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAddingProperty(false)}
                  disabled={creatingProperty}
                >
                  {t('cancel')}
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  disabled={saving}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="">{tAppt('noProperty')}</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setAddingProperty(true)}
                  disabled={saving}
                  aria-label={t('newProperty')}
                  title={t('newProperty')}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground">{t('dateLabel')}</label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-foreground">{t('timeLabel')}</label>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-foreground">{t('endTimeLabel')}</label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={saving}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground">{t('typeLabel')}</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AppointmentType)}
              disabled={saving}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              {APPOINTMENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {tAppt(`type.${value}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground">{t('descriptionLabel')}</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              disabled={saving}
              rows={2}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground">{t('notesLabel')}</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('notesPlaceholder')}
              disabled={saving}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
