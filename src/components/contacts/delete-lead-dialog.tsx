'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface DeleteLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  contactName: string;
  /** Called after a successful delete, before the dialog closes — the
   *  caller owns removing the lead from whatever local list it renders
   *  (Kanban deals, Inbox conversations, ...). */
  onDeleted: (contactId: string) => void;
}

/**
 * Shared "excluir lead" confirmation + delete action — same underlying
 * operation as the Contacts page's row delete (`contacts/page.tsx`),
 * reused here so Pipeline and Inbox cards don't duplicate it. A "lead"
 * has no separate table (see AGENTS task) — it IS the `contacts` row,
 * and deleting it cascades via existing FKs to its conversation,
 * messages, tags and notes (CASCADE). Deal rows would normally survive
 * with the link cleared (SET NULL — migration 004, extended by 057 for
 * deals.conversation_id), which is right for e.g. deleting a contact
 * from the Contacts page; here, deleting *the lead* also deletes its
 * Pipeline deal(s) explicitly, so no orphaned "no contact" card is left
 * behind on the Kanban board. Appointments/broadcast recipients still
 * survive with the link cleared either way.
 */
export function DeleteLeadDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  onDeleted,
}: DeleteLeadDialogProps) {
  const t = useTranslations('Leads.deleteDialog');
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!contactId) return;
    setDeleting(true);
    const supabase = createClient();

    // Delete any Pipeline deal(s) for this lead FIRST, while contact_id is
    // still set to match on — the contact FK (migration 004/057) clears
    // deals.contact_id/conversation_id rather than deleting the deal, which
    // is right for other deletion paths, but left alone here it would leave
    // an orphaned, contact-less "ghost" card behind on the Kanban board.
    // Best-effort: a failure here shouldn't block deleting the contact
    // itself, which is the action the user actually confirmed.
    const { error: dealsError } = await supabase
      .from('deals')
      .delete()
      .eq('contact_id', contactId);
    if (dealsError) {
      console.error('[delete-lead] failed to delete associated deals:', dealsError);
    }

    const { error } = await supabase.from('contacts').delete().eq('id', contactId);

    if (error) {
      console.error('[delete-lead] failed:', error);
      toast.error(t('toastFailedDelete'));
    } else {
      toast.success(t('toastDeleted'));
      onDeleted(contactId);
      onOpenChange(false);
    }
    setDeleting(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('title')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('description', { name: contactName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t('cancel')}
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting || !contactId}>
            {deleting && <Loader2 className="size-4 animate-spin" />}
            {t('deleteBtn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
