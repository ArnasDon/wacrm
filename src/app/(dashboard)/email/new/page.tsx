'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, ArrowLeft, Send } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { ListmonkGate } from '@/components/email/listmonk-status';
import type { ListmonkList, ListmonkTemplate } from '@/lib/listmonk/types';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export default function NewCampaignPage() {
  return (
    <div className="space-y-6">
      <ListmonkGate>{() => <Composer />}</ListmonkGate>
    </div>
  );
}

function Composer() {
  const router = useRouter();
  const t = useTranslations('Email.composer');
  const canSend = useCan('send-messages');

  const [lists, setLists] = useState<ListmonkList[]>([]);
  const [templates, setTemplates] = useState<ListmonkTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [selectedLists, setSelectedLists] = useState<number[]>([]);
  const [templateId, setTemplateId] = useState<number | undefined>();

  useEffect(() => {
    Promise.all([
      fetch('/api/email/lists').then((r) => r.json()),
      fetch('/api/email/templates').then((r) => r.json()),
    ])
      .then(([l, tpl]) => {
        setLists(l.lists ?? []);
        setTemplates(tpl.templates ?? []);
        const def = (tpl.templates ?? []).find(
          (x: ListmonkTemplate) => x.is_default
        );
        if (def) setTemplateId(def.id);
      })
      .catch(() => toast.error(t('loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  function toggleList(id: number) {
    setSelectedLists((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function save(startNow: boolean) {
    if (!name.trim() || !subject.trim()) {
      toast.error(t('nameSubjectRequired'));
      return;
    }
    if (selectedLists.length === 0) {
      toast.error(t('pickList'));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/email/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          subject: subject.trim(),
          body,
          lists: selectedLists,
          content_type: 'richtext',
          ...(templateId ? { template_id: templateId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t('createFailed'));

      if (startNow) {
        const startRes = await fetch(
          `/api/email/campaigns/${data.campaign.id}/status`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'running' }),
          }
        );
        const startData = await startRes.json();
        if (!startRes.ok) {
          // The draft exists; only the send failed. Say so precisely
          // rather than implying nothing was saved.
          throw new Error(
            t('savedButNotStarted', { error: startData.error ?? '' })
          );
        }
        toast.success(t('started'));
      } else {
        toast.success(t('savedDraft'));
      }
      router.push('/email');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('createFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/email')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="space-y-2">
            <Label htmlFor="name">{t('nameLabel')}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
            />
            <p className="text-muted-foreground text-xs">{t('nameHelp')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">{t('subjectLabel')}</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('subjectPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">{t('bodyLabel')}</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              className="font-mono text-sm"
              placeholder={t('bodyPlaceholder')}
            />
            <p className="text-muted-foreground text-xs">{t('bodyHelp')}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="border-border bg-card rounded-xl border p-4">
            <Label className="mb-3 block">{t('listsLabel')}</Label>
            {lists.length === 0 ? (
              <p className="text-muted-foreground text-xs">{t('noLists')}</p>
            ) : (
              <div className="space-y-2">
                {lists.map((l) => (
                  <label
                    key={l.id}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={selectedLists.includes(l.id)}
                      onCheckedChange={() => toggleList(l.id)}
                    />
                    <span className="text-foreground">{l.name}</span>
                    <span className="text-muted-foreground text-xs">
                      ({l.subscriber_count})
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {templates.length > 0 && (
            <div className="border-border bg-card rounded-xl border p-4">
              <Label htmlFor="template" className="mb-3 block">
                {t('templateLabel')}
              </Label>
              <select
                id="template"
                value={templateId ?? ''}
                onChange={(e) => setTemplateId(Number(e.target.value))}
                className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm"
              >
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button
              onClick={() => save(false)}
              disabled={saving || !canSend}
              variant="outline"
              className="w-full"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('saveDraft')}
            </Button>
            <Button
              onClick={() => save(true)}
              disabled={saving || !canSend}
              className="bg-primary text-primary-foreground hover:bg-primary/90 w-full"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {t('sendNow')}
            </Button>
            {!canSend && (
              <p className="text-muted-foreground text-center text-xs">
                {t('readOnly')}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
