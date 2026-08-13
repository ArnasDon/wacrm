'use client';

// ============================================================
// InviteSellerDialog
//
// Simpler sibling of InviteMemberDialog: no role/expiry choice (a
// seller account always gets its own independent, fully-privileged
// account — see /api/organization/sellers's own comment).
//
// Two modes, picked via the toggle below:
//   'email'  (default) — Supabase's own invite email, same as before.
//   'direct' — the owner sets the seller's password right here, no
//              email dependency at all. Added because the email path
//              depends on NEXT_PUBLIC_SITE_URL being configured
//              correctly AND on the recipient's mail provider actually
//              delivering the link — this gives a way in when either
//              of those isn't cooperating. The owner hands the
//              credentials to the seller directly afterward; nothing
//              here re-displays the password once submitted.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, Loader2, Mail, UserPlus } from 'lucide-react';
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
import { cn } from '@/lib/utils';

interface InviteSellerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful invite so the parent re-fetches the accounts list. */
  onInvited: () => void;
}

type InviteMode = 'email' | 'direct';
const MIN_PASSWORD_LEN = 6;

export function InviteSellerDialog({ open, onOpenChange, onInvited }: InviteSellerDialogProps) {
  const t = useTranslations('Settings.organization');
  const [mode, setMode] = useState<InviteMode>('email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setMode('email');
    setName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setSubmitting(false);
  }

  const passwordsValid =
    mode === 'email' || (password.length >= MIN_PASSWORD_LEN && password === confirmPassword);

  async function handleInvite() {
    if (mode === 'direct' && password !== confirmPassword) {
      toast.error(t('passwordMismatchToast'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/organization/sellers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'direct' ? { name, email, password } : { name, email },
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('inviteFailedToast'));
        return;
      }
      toast.success(mode === 'direct' ? t('accountCreatedToast') : t('invitedToast', { email }));
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

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode('email')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
              mode === 'email'
                ? 'border-primary/40 bg-primary-soft text-primary'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            <Mail className="size-4" />
            {t('modeEmail')}
          </button>
          <button
            type="button"
            onClick={() => setMode('direct')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
              mode === 'direct'
                ? 'border-primary/40 bg-primary-soft text-primary'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            <KeyRound className="size-4" />
            {t('modeDirect')}
          </button>
        </div>

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

          {mode === 'direct' && (
            <>
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('sellerPasswordLabel')}</Label>
                <Input
                  type="password"
                  placeholder={t('sellerPasswordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('sellerConfirmPasswordLabel')}</Label>
                <Input
                  type="password"
                  placeholder={t('sellerConfirmPasswordPlaceholder')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <p className="text-xs text-muted-foreground">{t('modeDirectHint')}</p>
            </>
          )}
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
            disabled={submitting || !name.trim() || !email.trim() || !passwordsValid}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {mode === 'direct' ? t('creating') : t('sending')}
              </>
            ) : mode === 'direct' ? (
              t('createAccountButton')
            ) : (
              t('inviteButton')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
