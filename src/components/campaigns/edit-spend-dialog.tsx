'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Pencil, Trash2 } from 'lucide-react';

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
import { formatCurrency } from '@/lib/currency';
import { localDayKey } from '@/lib/dashboard/date-utils';

interface SpendEntry {
  date: string;
  spend: number;
}

interface EditSpendDialogProps {
  campaignId: string;
  campaignName: string;
  currency: string;
  onSaved: () => void;
}

/**
 * Log a manual campaign's spend as dated entries.
 *
 * Deliberately does NOT take the campaign's current spend as a prop.
 * The previous version did, prefilled the input with it, and wrote the
 * result to today's row — so once the range-aggregated total included
 * more than one day, every save fed the inflated total back in and the
 * number climbed on its own. The dialog owns its data now: it loads the
 * entries, and each save only ever touches the one date being edited.
 *
 * Dates are computed with `localDayKey` (the operator's timezone, the
 * same clock the /campaigns range filter uses) and sent to the server,
 * which never invents one — see src/lib/ads/day-key.ts.
 */
export function EditSpendDialog({
  campaignId,
  campaignName,
  currency,
  onSaved,
}: EditSpendDialogProps) {
  const t = useTranslations('Campaigns.manual');
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<SpendEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [spend, setSpend] = useState('');
  const [date, setDate] = useState(() => localDayKey(new Date()));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/ads/campaigns/${campaignId}/spend`);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      setEntries(data.entries ?? []);
    }
    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(localDayKey(new Date()));
    setSpend('');
    loadEntries();
  }, [open, loadEntries]);

  async function handleSubmit() {
    const amount = Number(spend);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error(t('spendInvalid'));
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/ads/campaigns/${campaignId}/spend`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spend: amount, date }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error || t('editSpendFailed'));
      return;
    }
    toast.success(t('entrySaved'));
    setSpend('');
    await loadEntries();
    onSaved();
  }

  async function handleDelete(entryDate: string) {
    setDeleting(entryDate);
    const res = await fetch(`/api/ads/campaigns/${campaignId}/spend`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: entryDate }),
    });
    setDeleting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || t('deleteEntryFailed'));
      return;
    }
    await loadEntries();
    onSaved();
  }

  const total = entries.reduce((sum, e) => sum + Number(e.spend || 0), 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('editSpend')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{campaignName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('spendLabel')}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={spend}
                onChange={(e) => setSpend(e.target.value)}
                placeholder="0"
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('dateLabel')}</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('spendHint')}</p>

          <div className="border-t border-border pt-3">
            <p className="mb-2 text-xs font-medium text-foreground">{t('historyTitle')}</p>
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t('historyLoading')}
              </div>
            ) : entries.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('historyEmpty')}</p>
            ) : (
              <>
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {entries.map((e) => (
                    <li
                      key={e.date}
                      className="flex items-center justify-between gap-2 text-xs tabular-nums"
                    >
                      <span className="text-muted-foreground">{e.date}</span>
                      <span className="flex items-center gap-1">
                        <span className="text-foreground">
                          {formatCurrency(Number(e.spend), currency)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 text-muted-foreground hover:text-destructive"
                          aria-label={t('deleteEntry')}
                          disabled={deleting === e.date}
                          onClick={() => handleDelete(e.date)}
                        >
                          {deleting === e.date ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Trash2 className="size-3" />
                          )}
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex justify-between border-t border-border pt-2 text-xs">
                  <span className="text-muted-foreground">{t('totalSpend')}</span>
                  <span className="font-medium text-foreground tabular-nums">
                    {formatCurrency(total, currency)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            onClick={handleSubmit}
            disabled={saving || spend.trim() === ''}
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
