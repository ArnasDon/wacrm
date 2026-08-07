'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * "Reset conversations" — wipes every conversation/message for the
 * account. Meant to be run right after disconnecting one WhatsApp
 * number and before connecting a different one: leftover threads
 * still reference the old number's message ids and provider state,
 * which can surface as send errors once a different number/provider
 * goes live. Kept outside the Meta/Evolution tabs (below both) since
 * it applies regardless of which provider you're switching to.
 */
export function WhatsAppDangerZone() {
  const t = useTranslations('Settings.whatsapp.dangerZone');
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const CONFIRM_WORD = t('confirmWord');
  const canConfirm = confirmText.trim().toUpperCase() === CONFIRM_WORD.toUpperCase();

  async function handleReset() {
    if (!canConfirm) return;
    try {
      setDeleting(true);
      const res = await fetch('/api/whatsapp/conversations/reset', { method: 'DELETE' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('errorToast'));
        return;
      }
      toast.success(t('successToast', { count: payload.deleted ?? 0 }));
      setOpen(false);
      setConfirmText('');
    } catch (err) {
      console.error('[whatsapp-danger-zone] reset failed:', err);
      toast.error(t('errorToast'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" />
            {t('title')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setOpen(true)}
          >
            <Trash2 className="size-4" />
            {t('button')}
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirmText('');
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <AlertTriangle className="size-4 text-destructive" />
              {t('dialogTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('dialogDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label className="text-muted-foreground">
              {t('confirmLabel', { word: CONFIRM_WORD })}
            </Label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_WORD}
              className="border-border bg-muted text-foreground"
              autoComplete="off"
            />
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              className="border-border text-popover-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={!canConfirm || deleting}
              onClick={handleReset}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {t('confirmButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
