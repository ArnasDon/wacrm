'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface EditSpendDialogProps {
  campaignId: string;
  campaignName: string;
  currentSpend: number;
  onSaved: () => void;
}

/** Edit a manual campaign's cumulative spend-to-date (PATCH .../spend). */
export function EditSpendDialog({
  campaignId,
  campaignName,
  currentSpend,
  onSaved,
}: EditSpendDialogProps) {
  const t = useTranslations('Campaigns.manual');
  const [open, setOpen] = useState(false);
  const [spend, setSpend] = useState(String(currentSpend));
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setSaving(true);
    const res = await fetch(`/api/ads/campaigns/${campaignId}/spend`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spend: Number(spend) || 0 }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error || t('editSpendFailed'));
      return;
    }
    toast.success(t('editSpendSuccess'));
    setOpen(false);
    onSaved();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSpend(String(currentSpend));
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label={t('editSpend')}
          />
        }
      >
        <Pencil className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="bg-popover border-border sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('editSpend')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{campaignName}</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Label className="text-muted-foreground">{t('spendLabel')}</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={spend}
            onChange={(e) => setSpend(e.target.value)}
            className="bg-muted border-border text-foreground mt-2"
          />
          <p className="mt-2 text-xs text-muted-foreground">{t('spendHint')}</p>
        </div>
        <DialogFooter className="bg-popover border-border">
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
