'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Pencil, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExpandingDialogContent } from '@/components/ui/expanding-dialog-content';
import { useLocale, useTranslations } from 'next-intl';
import type { Appointment } from '@/types';
import { deleteAppointment, updateAppointmentStatus } from '@/lib/appointments/queries';
import { AppointmentFormDialog } from './appointment-form-dialog';

interface AppointmentDetailSheetProps {
  /** Null hides the sheet — the parent owns "which appointment", this
   *  component owns view/edit/delete once one is selected. */
  appointment: Appointment | null;
  /** The clicked card's own bounding box, captured at click time — see
   *  useFlipTransition. Null/undefined just falls back to a centered
   *  fade/grow, still animated. */
  originRect?: DOMRect | null;
  onClose: () => void;
  /** Called after a save or a delete actually lands, so the caller
   *  (e.g. AgendaWeek) can refetch. */
  onChanged: () => void;
}

export function AppointmentDetailSheet({
  appointment,
  originRect,
  onClose,
  onChanged,
}: AppointmentDetailSheetProps) {
  const t = useTranslations('Appointments.detail');
  const tAppt = useTranslations('Appointments');
  const locale = useLocale();
  const supabase = createClient();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [marking, setMarking] = useState(false);

  if (!appointment) return null;

  const isCompleted = appointment.status === 'completed';

  async function handleMarkDone() {
    if (!appointment || appointment.status === 'completed') return;
    setMarking(true);
    try {
      await updateAppointmentStatus(supabase, appointment.id, 'completed');
      toast.success(t('toastMarkedDone'));
      // Close so the Agenda da Semana grid (the caller's onChanged
      // refetch) is what the user sees reflect the new state, same
      // pattern as a successful edit/delete below.
      onChanged();
      onClose();
    } catch (err) {
      console.error('Failed to mark appointment as done:', err);
      toast.error(t('toastMarkDoneFailed'));
    } finally {
      setMarking(false);
    }
  }

  async function handleDelete() {
    if (!appointment) return;
    setDeleting(true);
    try {
      if (appointment.external_calendar_id) {
        // Best-effort, and deliberately not in its own try/catch that
        // could short-circuit the function — a failed Google-side
        // delete (network blip, already-revoked connection) shouldn't
        // block deleting the appointment locally; it just leaves a
        // stale event sitting on the agent's Google Calendar.
        await fetch('/api/calendar/sync', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ externalCalendarId: appointment.external_calendar_id }),
        }).catch((err) => console.error('[calendar sync] delete request failed:', err));
      }
      await deleteAppointment(supabase, appointment.id);
      toast.success(t('toastDeleted'));
      setDeleteConfirmOpen(false);
      onClose();
      onChanged();
    } catch (err) {
      console.error('Failed to delete appointment:', err);
      toast.error(t('toastDeleteFailed'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Dialog
        open={!!appointment && !editOpen}
        // Same fix as DealDetailDrawer: `open` is computed from two
        // sources (`appointment` and `editOpen`), so a false transition
        // caused by clicking "Editar" (which flips `editOpen`, not a
        // real dismiss) must not call `onClose()` — that would null out
        // `appointment` in the parent and unmount this whole component,
        // including the `<AppointmentFormDialog>` that was supposed to
        // open, silently closing everything instead of opening the
        // edit form.
        onOpenChange={(open) => {
          if (!open && !editOpen) onClose();
        }}
      >
        <DialogPortal>
          <DialogOverlay />
          <ExpandingDialogContent originRect={originRect}>
          <DialogHeader>
            <DialogTitle>{appointment.title}</DialogTitle>
            <DialogDescription>{tAppt(`type.${appointment.type}`)}</DialogDescription>
          </DialogHeader>

          <dl className="space-y-3 text-sm">
            <DetailRow
              label={t('client')}
              value={
                appointment.contact?.name ||
                appointment.contact?.phone ||
                appointment.client_name ||
                tAppt('noContact')
              }
            />
            {appointment.contact?.phone && (
              <DetailRow label={t('phone')} value={appointment.contact.phone} />
            )}
            <DetailRow label={t('property')} value={appointment.property?.name || tAppt('noProperty')} />
            <DetailRow label={t('date')} value={formatDateLabel(appointment.scheduled_date, locale)} />
            <DetailRow label={t('time')} value={formatTimeRangeLabel(appointment, t('allDay'))} />
            {appointment.description && (
              <DetailRow label={t('descriptionLabel')} value={appointment.description} multiline />
            )}
            {appointment.notes && (
              <DetailRow label={t('notesLabel')} value={appointment.notes} multiline />
            )}
            <DetailRow label={t('createdAt')} value={formatDateTimeLabel(appointment.created_at, locale)} />
            <DetailRow label={t('updatedAt')} value={formatDateTimeLabel(appointment.updated_at, locale)} />
          </dl>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
              <Trash2 className="h-4 w-4" />
              {t('delete')}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleMarkDone} disabled={isCompleted || marking}>
                {marking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {isCompleted ? t('completedLabel') : t('markDone')}
              </Button>
              <Button onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                {t('edit')}
              </Button>
            </div>
          </DialogFooter>
          </ExpandingDialogContent>
        </DialogPortal>
      </Dialog>

      <AppointmentFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        appointment={appointment}
        onSaved={() => {
          onChanged();
          onClose();
        }}
      />

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>{t('deleteConfirm', { name: appointment.title })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DetailRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-foreground ${multiline ? 'whitespace-pre-wrap' : ''}`}>{value}</dd>
    </div>
  );
}

function formatTimeRangeLabel(appointment: Appointment, allDayLabel: string): string {
  if (!appointment.scheduled_time) return allDayLabel;
  const start = appointment.scheduled_time.slice(0, 5);
  if (!appointment.scheduled_end_time) return start;
  return `${start} – ${appointment.scheduled_end_time.slice(0, 5)}`;
}

function formatDateLabel(dateKey: string, locale: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
}

function formatDateTimeLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}
