'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Loader2, Plus, Trash2, Pencil } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { SettingsPanelHead } from './settings-panel-head';

interface EmailTemplateRow {
  id: string;
  name: string;
  subject: string;
  updated_at: string;
}

const EMPTY_FORM = { name: '', subject: '', body_html: '' };

/**
 * Email templates (HTML full — copy/paste del usuario, §10.2).
 * agent+ read, owner+ write (lo refuerza el route con requireRole).
 * Interpolación `{{ name }}` / `{{ email }}` / `{{ vars.* }}` resuelta
 * en el envío (send_email step o /api/email/send) — no en el editor.
 */
export function EmailTemplatesManager() {
  const t = useTranslations('Settings.emailTemplates');
  const { accountId } = useAuth();

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<EmailTemplateRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/email/templates', { cache: 'no-store' });
      const data = (await res.json()) as { templates?: EmailTemplateRow[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'failed to list');
      setTemplates(data.templates ?? []);
    } catch (err) {
      console.error('Failed to load email templates:', err);
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!accountId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTemplates();
  }, [accountId, fetchTemplates]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  async function openEdit(row: EmailTemplateRow) {
    setEditingId(row.id);
    setForm({ name: row.name, subject: row.subject, body_html: '' });
    setDialogOpen(true);
    // El HTML no viene en la lista; se carga por id al abrir el editor.
    try {
      const res = await fetch(`/api/email/templates/${row.id}`, { cache: 'no-store' });
      const data = (await res.json()) as {
        template?: { subject?: string; body_html?: string };
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'failed to load');
      setForm((f) => ({
        ...f,
        subject: data.template?.subject ?? f.subject,
        body_html: data.template?.body_html ?? '',
      }));
    } catch (err) {
      console.error('Failed to load email template body:', err);
      toast.error(t('loadError'));
    }
  }

  async function handleSave() {
    if (!form.name.trim() || !form.subject.trim() || !form.body_html.trim()) {
      toast.error(t('required'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/email/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'failed to save');
      toast.success(editingId ? t('updated') : t('created'));
      setDialogOpen(false);
      await fetchTemplates();
    } catch (err) {
      console.error('Failed to save email template:', err);
      toast.error(t('saveError'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(row: EmailTemplateRow) {
    if (!confirm(`${t('confirmDelete')} "${row.name}"?`)) return;
    setDeletingId(row.id);
    try {
      const res = await fetch(`/api/email/templates?id=${row.id}`, { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'failed to delete');
      toast.success(t('deleted'));
      await fetchTemplates();
    } catch (err) {
      console.error('Failed to delete email template:', err);
      toast.error(t('deleteError'));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-foreground text-base">{t('listTitle')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('listDesc')}
              </CardDescription>
            </div>
            <Button size="sm" onClick={openCreate} className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0">
              <Plus className="size-4" />
              {t('newTemplate')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : templates.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="space-y-2">
              {templates.map((row) => (
                <li key={row.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{row.subject}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 shrink-0 border-border text-muted-foreground hover:text-foreground"
                    onClick={() => openEdit(row)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 shrink-0 border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
                    disabled={deletingId === row.id}
                    onClick={() => handleDelete(row)}
                  >
                    {deletingId === row.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editingId ? t('editTitle') : t('createTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('dialogDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('name')}</Label>
              <Input
                value={form.name}
                disabled={!!editingId}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="missed_call"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">{t('nameHint')}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('subject')}</Label>
              <Input
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="Hola {{name}}, vimos tu llamada…"
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('bodyHtml')}</Label>
              <Textarea
                value={form.body_html}
                onChange={(e) => setForm((f) => ({ ...f, body_html: e.target.value }))}
                rows={12}
                placeholder="<p>Hola {{name}}, …</p>"
                className="bg-muted border-border font-mono text-xs text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">{t('varsHint')}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-border text-muted-foreground hover:text-foreground">
              {t('cancel')}
            </Button>
            <Button onClick={handleSave} disabled={submitting} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
