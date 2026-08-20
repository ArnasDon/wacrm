'use client';

import { readResponseJson } from '@/lib/http/response-json';

// ============================================================
// RequestSeatDialog — Settings → Members → "Solicitud de accesos"
//
// Every account may add members freely up to accounts.seat_limit,
// backfilled to today's headcount so nobody already invited is
// affected. Growing past that costs Q100/seat and requires Angel to
// unlock it by hand in /admin. This dialog is how an admin asks: pick
// the intended role for the new user, attach a photo of the payment
// receipt, submit. It only sends an email (POST
// /api/billing/request-seat) — there's no persisted request row, the
// email IS the record, same shape as the existing "Reportar pago"
// flow in Settings → Facturación.
// ============================================================

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Paperclip, Send, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslations } from 'next-intl';

type RequestRole = 'admin' | 'agent' | 'viewer';

interface RequestSeatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ALLOWED_RECEIPT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_NOTES_LEN = 500;

export function RequestSeatDialog({
  open,
  onOpenChange,
}: RequestSeatDialogProps) {
  const t = useTranslations('Settings.requestSeat');
  const tRoles = useTranslations('Settings.roles');
  const [role, setRole] = useState<RequestRole>('agent');
  const [notes, setNotes] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setRole('agent');
    setNotes('');
    handleReceiptChange(null);
    setSubmitting(false);
  }

  function handleReceiptChange(file: File | null) {
    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    if (!file) {
      setReceipt(null);
      setReceiptPreview(null);
      return;
    }
    if (!ALLOWED_RECEIPT_TYPES.includes(file.type)) {
      toast.error(t('errorReceiptType'));
      return;
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      toast.error(t('errorReceiptSize'));
      return;
    }
    setReceipt(file);
    setReceiptPreview(URL.createObjectURL(file));
  }

  async function handleSubmit() {
    if (!receipt) {
      toast.error(t('errorNoReceipt'));
      return;
    }
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('role', role);
      if (notes.trim()) formData.append('notes', notes.trim());
      formData.append('receipt', receipt);

      const res = await fetch('/api/billing/request-seat', {
        method: 'POST',
        body: formData,
      });
      const payload = await readResponseJson<{ error?: string }>(res).catch(
        (): { error?: string } => ({})
      );
      if (!res.ok) {
        toast.error(payload.error || t('errorGeneric'));
        return;
      }
      toast.success(t('successToast'));
      onOpenChange(false);
    } catch (err) {
      console.error('[RequestSeatDialog] submit error:', err);
      toast.error(t('errorGeneric'));
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
          <DialogTitle className="text-popover-foreground">
            {t('dialogTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('dialogDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
            {t('priceNotice')}
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('roleLabel')}</Label>
            <Select
              value={role}
              onValueChange={(v) => v && setRole(v as RequestRole)}
            >
              <SelectTrigger className="bg-muted border-border text-foreground w-full">
                <SelectValue>{tRoles(role)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{tRoles('admin')}</SelectItem>
                <SelectItem value="agent">{tRoles('agent')}</SelectItem>
                <SelectItem value="viewer">{tRoles('viewer')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">
              {t('notesLabel')}{' '}
              <span className="text-muted-foreground text-xs">
                {t('optional')}
              </span>
            </Label>
            <Textarea
              placeholder={t('notesPlaceholder')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={MAX_NOTES_LEN}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">
              {t('receiptLabel')}
            </Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) =>
                handleReceiptChange(e.target.files?.[0] ?? null)
              }
            />
            {receiptPreview ? (
              <div className="border-border relative inline-flex overflow-hidden rounded-lg border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={receiptPreview}
                  alt={t('receiptLabel')}
                  className="max-h-40 w-auto object-contain"
                />
                <button
                  type="button"
                  onClick={() => {
                    handleReceiptChange(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="bg-background/80 text-foreground hover:bg-background absolute top-1 right-1 rounded-full p-1"
                  aria-label={t('removeReceipt')}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-4" />
                {t('attach')}
              </Button>
            )}
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
            onClick={handleSubmit}
            disabled={submitting || !receipt}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('submitting')}
              </>
            ) : (
              <>
                <Send className="size-4" />
                {t('submit')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
