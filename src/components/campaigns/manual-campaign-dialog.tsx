'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { localDayKey } from '@/lib/dashboard/date-utils';

interface ManualCampaignDialogProps {
  defaultCurrency: string;
  onCreated: () => void;
}

/**
 * "Add manual campaign" — the entry point for a platform with no API
 * (Google Ads today, or anything else). Creates the campaign plus an
 * optional first dated spend entry in one call
 * (POST /api/ads/campaigns/manual). More entries are added later from
 * the row's spend dialog; that route documents the dated-entry model.
 */
export function ManualCampaignDialog({ defaultCurrency, onCreated }: ManualCampaignDialogProps) {
  const t = useTranslations('Campaigns.manual');

  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<'google' | 'other'>('google');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [spend, setSpend] = useState('');
  // The operator's calendar day, not the server's — see
  // src/lib/ads/day-key.ts.
  const [date, setDate] = useState(() => localDayKey(new Date()));
  const [saving, setSaving] = useState(false);

  function reset() {
    setPlatform('google');
    setName('');
    setCurrency(defaultCurrency);
    setSpend('');
    setDate(localDayKey(new Date()));
  }

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    const res = await fetch('/api/ads/campaigns/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform,
        name: name.trim(),
        currency,
        spend: spend ? Number(spend) : 0,
        date,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error || t('createFailed'));
      return;
    }
    toast.success(t('created', { name: name.trim() }));
    reset();
    setOpen(false);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="border-border text-foreground" />
        }
      >
        <Plus className="size-3.5" />
        {t('trigger')}
      </DialogTrigger>
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('title')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('platformLabel')}</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as 'google' | 'other')}>
              <SelectTrigger className="bg-muted border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="google">{t('platformGoogle')}</SelectItem>
                <SelectItem value="other">{t('platformOther')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t('nameLabel')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              className="bg-muted border-border text-foreground"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('currencyLabel')}</Label>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                className="bg-muted border-border text-foreground uppercase"
              />
            </div>
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
          <p className="text-xs text-muted-foreground">{t('spendHint')}</p>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
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
