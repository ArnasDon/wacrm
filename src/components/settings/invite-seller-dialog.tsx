'use client';

// ============================================================
// InviteSellerDialog
//
// Simpler sibling of InviteMemberDialog: no role/expiry choice (a
// seller account always gets its own independent, fully-privileged
// account — see /api/organization/sellers's own comment) and no
// share-link result step, since Supabase's own invite email is what
// actually reaches the seller. Just name + email → POST → toast.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface InviteSellerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful invite so the parent re-fetches the accounts list. */
  onInvited: () => void;
}

export function InviteSellerDialog({ open, onOpenChange, onInvited }: InviteSellerDialogProps) {
  const t = useTranslations('Settings.organization');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName('');
    setEmail('');
    setSubmitting(false);
  }

  async function handleInvite() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/organization/sellers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('inviteFailedToast'));
        return;
      }
      toast.success(t('invitedToast', { email }));
      onInvited();
      onOpenChange(false);
    } catch {
      toast.error(t('serverUnreachableToast'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <UserPlus className="size-4 text-primary" />
            {t('inviteSellerTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('inviteSellerDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('sellerNameLabel')}</Label>
            <Input
              placeholder={t('sellerNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('sellerEmailLabel')}</Label>
            <Input
              type="email"
              placeholder={t('sellerEmailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleInvite}
            disabled={submitting || !name.trim() || !email.trim()}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('sending')}
              </>
            ) : (
              t('inviteButton')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
