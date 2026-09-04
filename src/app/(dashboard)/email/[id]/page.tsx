'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft,
  Eye,
  Loader2,
  Pencil,
  Play,
  Save,
  Send,
} from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { ListmonkGate } from '@/components/email/listmonk-status';
import type {
  ListmonkCampaign,
  ListmonkList,
  ListmonkTemplate,
} from '@/lib/listmonk/types';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export default function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <div className="space-y-6">
      <ListmonkGate>{() => <Editor id={Number(id)} />}</ListmonkGate>
    </div>
  );
}

/** Merge fields listmonk substitutes per recipient. */
const MERGE_TAGS = [
  { label: 'First name', tag: '{{ .Subscriber.FirstName }}' },
  { label: 'Full name', tag: '{{ .Subscriber.Name }}' },
  { label: 'Email', tag: '{{ .Subscriber.Email }}' },
  { label: 'Phone (from CRM)', tag: '{{ .Subscriber.Attribs.phone }}' },
  { label: 'Unsubscribe link', tag: '{{ UnsubscribeURL }}' },
];

function Editor({ id }: { id: number }) {
  const router = useRouter();
  const t = useTranslations('Email.editor');
  const canSend = useCan('send-messages');

  const [campaign, setCampaign] = useState<ListmonkCampaign | null>(null);
  const [lists, setLists] = useState<ListmonkList[]>([]);
  const [templates, setTemplates] = useState<ListmonkTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [selectedLists, setSelectedLists] = useState<number[]>([]);
  const [templateId, setTemplateId] = useState<number | undefined>();

  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/email/campaigns/${id}`).then((r) => r.json()),
      fetch('/api/email/lists').then((r) => r.json()),
      fetch('/api/email/templates').then((r) => r.json()),
    ])
      .then(([c, l, tpl]) => {
        if (c.error) throw new Error(c.error);
        const camp: ListmonkCampaign = c.campaign;
        setCampaign(camp);
        setName(camp.name);
        setSubject(camp.subject);
        setBody(camp.body);
        setSelectedLists(camp.lists.map((x) => x.id));
        setTemplateId(camp.template_id ?? undefined);
        setLists(l.lists ?? []);
        setTemplates(tpl.templates ?? []);
      })
      .catch((e) => toast.error(e.message ?? t('loadFailed')))
      .finally(() => setLoading(false));
  }, [id, t]);

  // A campaign that has already been sent is history, not a draft —
  // listmonk rejects edits to it, so the form goes read-only rather
  // than letting someone type into a field that cannot be saved.
  const locked =
    campaign?.status === 'finished' || campaign?.status === 'cancelled';

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/email/campaigns/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          subject,
          body,
          lists: selectedLists,
          content_type: 'richtext',
          ...(templateId ? { template_id: templateId } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? t('saveFailed'));
      setCampaign(d.campaign);
      toast.success(t('saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [id, name, subject, body, selectedLists, templateId, t]);

  async function showPreview() {
    setTab('preview');
    setPreviewing(true);
    try {
      const res = await fetch(`/api/email/campaigns/${id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body,
          content_type: 'richtext',
          ...(templateId ? { template_id: templateId } : {}),
        }),
      });
      const html = await res.text();
      if (!res.ok) throw new Error(t('previewFailed'));
      setPreviewHtml(html);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('previewFailed'));
      setTab('write');
    } finally {
      setPreviewing(false);
    }
  }

  async function sendTest() {
    if (!testTo.trim()) {
      toast.error(t('testAddressRequired'));
      return;
    }
    setTesting(true);
    try {
      // Test sends use the SAVED body, so persist first — otherwise
      // the author proofreads a version that isn't the one on screen.
      await save();
      const res = await fetch(`/api/email/campaigns/${id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: [testTo.trim()] }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? t('testFailed'));
      toast.success(t('testSent', { email: testTo.trim() }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('testFailed'));
    } finally {
      setTesting(false);
    }
  }

  async function start() {
    await save();
    try {
      const res = await fetch(`/api/email/campaigns/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'running' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? t('startFailed'));
      toast.success(t('started'));
      router.push('/email');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('startFailed'));
    }
  }

  function insertTag(tag: string) {
    setBody((b) => `${b}${tag}`);
    setTab('write');
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
        <div className="min-w-0 flex-1">
          <h1 className="text-foreground truncate text-2xl font-bold">
            {name || t('untitled')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('statusLine', { status: campaign?.status ?? 'draft' })}
          </p>
        </div>
      </div>

      {locked && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          {t('lockedNotice')}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="space-y-2">
            <Label htmlFor="name">{t('nameLabel')}</Label>
            <Input
              id="name"
              value={name}
              disabled={locked}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">{t('subjectLabel')}</Label>
            <Input
              id="subject"
              value={subject}
              disabled={locked}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="body">{t('bodyLabel')}</Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={tab === 'write' ? 'default' : 'outline'}
                  onClick={() => setTab('write')}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t('write')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={tab === 'preview' ? 'default' : 'outline'}
                  onClick={showPreview}
                >
                  {previewing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  {t('preview')}
                </Button>
              </div>
            </div>

            {tab === 'write' ? (
              <Textarea
                id="body"
                value={body}
                disabled={locked}
                onChange={(e) => setBody(e.target.value)}
                rows={20}
                className="font-mono text-sm"
                placeholder={t('bodyPlaceholder')}
              />
            ) : (
              // Sandboxed: campaign HTML is content, and must never
              // run script or navigate inside the CRM's origin.
              <iframe
                title={t('preview')}
                srcDoc={previewHtml}
                sandbox=""
                className="border-border h-[32rem] w-full rounded-md border bg-white"
              />
            )}
            <p className="text-muted-foreground text-xs">{t('bodyHelp')}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="border-border bg-card rounded-xl border p-4">
            <Label className="mb-3 block">{t('listsLabel')}</Label>
            <div className="space-y-2">
              {lists.map((l) => (
                <label
                  key={l.id}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={selectedLists.includes(l.id)}
                    disabled={locked}
                    onCheckedChange={() =>
                      setSelectedLists((p) =>
                        p.includes(l.id)
                          ? p.filter((x) => x !== l.id)
                          : [...p, l.id]
                      )
                    }
                  />
                  <span className="text-foreground">{l.name}</span>
                  <span className="text-muted-foreground text-xs">
                    ({l.subscriber_count})
                  </span>
                </label>
              ))}
            </div>
          </div>

          {templates.length > 0 && (
            <div className="border-border bg-card rounded-xl border p-4">
              <Label htmlFor="template" className="mb-3 block">
                {t('templateLabel')}
              </Label>
              <select
                id="template"
                value={templateId ?? ''}
                disabled={locked}
                onChange={(e) => setTemplateId(Number(e.target.value))}
                className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              >
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="border-border bg-card rounded-xl border p-4">
            <Label className="mb-2 block">{t('mergeTagsLabel')}</Label>
            <p className="text-muted-foreground mb-3 text-xs">
              {t('mergeTagsHelp')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MERGE_TAGS.map((m) => (
                <button
                  key={m.tag}
                  type="button"
                  disabled={locked}
                  onClick={() => insertTag(m.tag)}
                  className="border-border bg-muted text-muted-foreground hover:border-primary/40 hover:text-foreground rounded-full border px-2 py-1 text-[11px] transition-colors disabled:opacity-50"
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-border bg-card space-y-3 rounded-xl border p-4">
            <Label htmlFor="testTo">{t('testHeading')}</Label>
            <p className="text-muted-foreground text-xs">{t('testHelp')}</p>
            <Input
              id="testTo"
              value={testTo}
              disabled={locked || !canSend}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@yourdomain.com"
            />
            <Button
              variant="outline"
              className="w-full"
              disabled={locked || !canSend || testing}
              onClick={sendTest}
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {t('sendTest')}
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="w-full"
              disabled={locked || !canSend || saving}
              onClick={save}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t('save')}
            </Button>
            {(campaign?.status === 'draft' ||
              campaign?.status === 'paused') && (
              <Button
                className="bg-primary text-primary-foreground hover:bg-primary/90 w-full"
                disabled={locked || !canSend || saving}
                onClick={start}
              >
                <Play className="h-4 w-4" />
                {t('saveAndSend')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
