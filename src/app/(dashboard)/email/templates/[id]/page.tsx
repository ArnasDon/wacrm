'use client';

import { useEffect, useState, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Eye, Loader2, Pencil, Save, Trash2 } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { ListmonkGate } from '@/components/email/listmonk-status';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

type Kind = 'tx' | 'campaign';

/**
 * Starter bodies so a new template is never a blank textarea. Both are
 * valid as-is: the campaign one carries the required content
 * placeholder; the tx one shows the CRM data the automation/flow steps
 * hand over.
 */
const STARTER: Record<Kind, string> = {
  tx: `<p>Hi {{ .Tx.Data.contact.first_name }},</p>

<p>Thanks for reaching out to us on WhatsApp. Here is the information you asked for.</p>

<p>We have your number as {{ .Tx.Data.contact.phone }} — reply on WhatsApp any time.</p>

<p>— The team</p>`,
  campaign: `<!doctype html>
<html>
  <body style="margin:0;padding:24px;font-family:Helvetica,Arial,sans-serif;background:#f6f6f6;">
    <div style="max-width:600px;margin:0 auto;background:#fff;padding:32px;border-radius:8px;">
      {{ template "content" . }}
      <hr style="border:0;border-top:1px solid #eee;margin:32px 0 16px;">
      <p style="font-size:12px;color:#888;">
        <a href="{{ UnsubscribeURL }}">Unsubscribe</a>
      </p>
    </div>
  </body>
</html>`,
};

export default function TemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <div className="space-y-6">
      <ListmonkGate>{() => <Editor idParam={id} />}</ListmonkGate>
    </div>
  );
}

function Editor({ idParam }: { idParam: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const t = useTranslations('Email.templateEditor');
  const canEdit = useCan('edit-settings');

  const isNew = idParam === 'new';
  const id = isNew ? null : Number(idParam);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState<Kind>(
    search.get('type') === 'campaign' ? 'campaign' : 'tx'
  );
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(
    STARTER[search.get('type') === 'campaign' ? 'campaign' : 'tx']
  );
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    if (isNew || !id) return;
    fetch(`/api/email/templates/${id}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? t('loadFailed'));
        const tpl = d.template;
        setKind(tpl.type === 'tx' ? 'tx' : 'campaign');
        setName(tpl.name ?? '');
        setSubject(tpl.subject ?? '');
        setBody(tpl.body ?? '');
        setIsDefault(Boolean(tpl.is_default));
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [id, isNew, t]);

  async function save() {
    if (!name.trim()) {
      toast.error(t('nameRequired'));
      return;
    }
    if (kind === 'tx' && !subject.trim()) {
      toast.error(t('subjectRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        isNew ? '/api/email/templates' : `/api/email/templates/${id}`,
        {
          method: isNew ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            type: kind,
            subject,
            body,
          }),
        }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? t('saveFailed'));
      toast.success(t('saved'));
      if (isNew) router.replace(`/email/templates/${d.template.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!id || !confirm(t('confirmDelete'))) return;
    try {
      const res = await fetch(`/api/email/templates/${id}`, {
        method: 'DELETE',
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? t('deleteFailed'));
      toast.success(t('deleted'));
      router.push('/email/templates');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('deleteFailed'));
    }
  }

  async function showPreview() {
    setTab('preview');
    setPreviewing(true);
    try {
      const res = await fetch('/api/email/templates/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, type: kind }),
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/email/templates')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-foreground truncate text-2xl font-bold">
            {isNew ? t('newTitle') : name || t('untitled')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {kind === 'tx' ? t('txExplainer') : t('campaignExplainer')}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">{t('nameLabel')}</Label>
              <Input
                id="name"
                value={name}
                disabled={!canEdit}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  kind === 'tx'
                    ? t('txNamePlaceholder')
                    : t('campaignNamePlaceholder')
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kind">{t('kindLabel')}</Label>
              <select
                id="kind"
                value={kind}
                disabled={!canEdit || !isNew}
                onChange={(e) => {
                  const k = e.target.value as Kind;
                  setKind(k);
                  if (isNew) setBody(STARTER[k]);
                }}
                className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="tx">{t('kindTx')}</option>
                <option value="campaign">{t('kindCampaign')}</option>
              </select>
            </div>
          </div>

          {kind === 'tx' && (
            <div className="space-y-2">
              <Label htmlFor="subject">{t('subjectLabel')}</Label>
              <Input
                id="subject"
                value={subject}
                disabled={!canEdit}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t('subjectPlaceholder')}
              />
              <p className="text-muted-foreground text-xs">
                {t('subjectHelp')}
              </p>
            </div>
          )}

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
                disabled={!canEdit}
                onChange={(e) => setBody(e.target.value)}
                rows={22}
                className="font-mono text-sm"
              />
            ) : (
              <iframe
                title={t('preview')}
                srcDoc={previewHtml}
                sandbox=""
                className="border-border h-[34rem] w-full rounded-md border bg-white"
              />
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="border-border bg-card rounded-xl border p-4">
            <p className="text-foreground mb-2 text-xs font-semibold">
              {t('varsHeading')}
            </p>
            <p className="text-muted-foreground mb-3 text-xs">
              {kind === 'tx' ? t('varsTxHelp') : t('varsCampaignHelp')}
            </p>
            <ul className="text-muted-foreground space-y-1 font-mono text-[11px]">
              {(kind === 'tx'
                ? [
                    '.Tx.Data.contact.first_name',
                    '.Tx.Data.contact.name',
                    '.Tx.Data.contact.email',
                    '.Tx.Data.contact.phone',
                    '.Tx.Data.contact.company',
                    '.Tx.Data.vars.<name>',
                    '.Tx.Data.message.text',
                  ]
                : [
                    '{{ template "content" . }}',
                    '{{ .Subscriber.FirstName }}',
                    '{{ .Subscriber.Attribs.phone }}',
                    '{{ UnsubscribeURL }}',
                    '{{ .Campaign.Subject }}',
                  ]
              ).map((v) => (
                <li key={v} className="bg-muted rounded px-2 py-1">
                  {kind === 'tx' ? `{{ ${v} }}` : v}
                </li>
              ))}
            </ul>
          </div>

          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90 w-full"
            disabled={!canEdit || saving}
            onClick={save}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t('save')}
          </Button>
          {!isNew && !isDefault && (
            <Button
              variant="outline"
              className="w-full text-red-400 hover:bg-red-500/10 hover:text-red-300"
              disabled={!canEdit}
              onClick={remove}
            >
              <Trash2 className="h-4 w-4" />
              {t('delete')}
            </Button>
          )}
          {!canEdit && (
            <p className="text-muted-foreground text-center text-xs">
              {t('readOnly')}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
