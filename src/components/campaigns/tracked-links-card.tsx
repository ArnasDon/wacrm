'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy, Link2, Loader2, Plus, Trash2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
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

interface TrackedLink {
  id: string;
  slug: string;
  name: string;
  source: 'google_ads' | 'web' | 'organic' | 'other';
  campaign_id: string | null;
  whatsapp_number: string;
  clicks: number;
  last_clicked_at: string | null;
}

interface CampaignOption {
  id: string;
  name: string;
}

const LINK_SOURCES = ['google_ads', 'web', 'organic', 'other'] as const;

/**
 * Tracked links — the attribution path for channels with no referral
 * of their own (Google Ads, a landing page, a flyer). Each link
 * redirects through /l/<slug> to a pre-filled WhatsApp message; the
 * webhook picks the code back out of the customer's message (see
 * src/lib/attribution/ref-token.ts).
 */
export function TrackedLinksCard({ campaigns }: { campaigns: CampaignOption[] }) {
  const t = useTranslations('Campaigns.trackedLinks');
  const { canEditSettings } = useAuth();

  const [links, setLinks] = useState<TrackedLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [source, setSource] = useState<TrackedLink['source']>('google_ads');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [messageTemplate, setMessageTemplate] = useState('');
  const [campaignId, setCampaignId] = useState<string>('none');

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/tracked-links');
    if (res.ok) {
      const data = await res.json();
      setLinks(data.trackedLinks ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLinks();
  }, [fetchLinks]);

  function resetForm() {
    setName('');
    setSource('google_ads');
    setWhatsappNumber('');
    setMessageTemplate('');
    setCampaignId('none');
  }

  async function handleCreate() {
    if (!name.trim() || !whatsappNumber.trim()) return;
    setSaving(true);
    const res = await fetch('/api/tracked-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        source,
        whatsappNumber,
        messageTemplate,
        campaignId: campaignId === 'none' ? null : campaignId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error || t('createFailed'));
      return;
    }
    toast.success(t('created'));
    resetForm();
    setOpen(false);
    fetchLinks();
  }

  async function handleDelete(id: string) {
    setRemovingId(id);
    const res = await fetch(`/api/tracked-links/${id}`, { method: 'DELETE' });
    setRemovingId(null);
    if (!res.ok) {
      toast.error(t('deleteFailed'));
      return;
    }
    toast.success(t('deleted'));
    fetchLinks();
  }

  function linkUrl(slug: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/l/${slug}`;
  }

  async function copyLink(slug: string) {
    await navigator.clipboard.writeText(linkUrl(slug));
    toast.success(t('copied'));
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Link2 className="size-4 text-primary" />
            {t('title')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">{t('description')}</CardDescription>
        </div>
        {canEditSettings && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              render={
                <Button variant="outline" size="sm" className="border-border text-foreground shrink-0" />
              }
            >
              <Plus className="size-3.5" />
              {t('newLink')}
            </DialogTrigger>
            <DialogContent className="bg-popover border-border sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-popover-foreground">{t('newLink')}</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {t('newLinkDesc')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t('nameLabel')}</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('namePlaceholder')}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t('sourceLabel')}</Label>
                  <Select value={source} onValueChange={(v) => v && setSource(v as TrackedLink['source'])}>
                    <SelectTrigger className="bg-muted border-border text-foreground">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LINK_SOURCES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(`source.${s}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t('phoneLabel')}</Label>
                  <Input
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    placeholder="+51987654321"
                    className="bg-muted border-border text-foreground"
                  />
                  <p className="text-xs text-muted-foreground">{t('phoneHint')}</p>
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t('messageLabel')}</Label>
                  <Textarea
                    value={messageTemplate}
                    onChange={(e) => setMessageTemplate(e.target.value)}
                    placeholder={t('messagePlaceholder')}
                    className="bg-muted border-border text-foreground"
                    rows={2}
                  />
                </div>
                {campaigns.length > 0 && (
                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">{t('campaignLabel')}</Label>
                    <Select value={campaignId} onValueChange={(v) => v && setCampaignId(v)}>
                      <SelectTrigger className="bg-muted border-border text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('noCampaign')}</SelectItem>
                        {campaigns.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <DialogFooter className="bg-popover border-border">
                <Button
                  onClick={handleCreate}
                  disabled={saving || !name.trim() || !whatsappNumber.trim()}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t('save')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('loading')}
          </div>
        ) : links.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noLinks')}</p>
        ) : (
          <div className="space-y-2">
            {links.map((link) => (
              <div
                key={link.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{link.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {t(`source.${link.source}`)} · {linkUrl(link.slug)} ·{' '}
                    {t('clicks', { count: link.clicks })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    onClick={() => copyLink(link.slug)}
                    aria-label={t('copyLink')}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  {canEditSettings && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      disabled={removingId === link.id}
                      onClick={() => handleDelete(link.id)}
                      aria-label={t('deleteLink')}
                    >
                      {removingId === link.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
