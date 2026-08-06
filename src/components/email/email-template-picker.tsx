'use client';

import { useEffect, useState } from 'react';
import { EmailTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

interface EmailTemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** contactId del contacto al que se envía (requiere email). */
  contactId: string;
}

/**
 * Selector de templates de email para "Send email" desde el detalle de un
 * contacto. Lista `email_templates` vía /api/email/templates y envía con
 * `/api/email/send` (mismo route que el inbox — interpola `{{ name }}`,
 * `{{ email }}`, etc. con `contactText`).
 */
export function EmailTemplatePicker({
  open,
  onOpenChange,
  contactId,
}: EmailTemplatePickerProps) {
  const t = useTranslations('Contacts.detailView.emailPicker');
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EmailTemplate | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setSelected(null);
      try {
        const res = await fetch('/api/email/templates', { cache: 'no-store' });
        const data = (await res.json()) as { templates?: EmailTemplate[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? 'failed to list');
        if (!cancelled) setTemplates(data.templates ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleSend() {
    if (!selected) return;
    setSending(true);
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId,
          template: selected.name,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(payload.error ?? `HTTP ${res.status}`);
        return;
      }
      toast.success(t('toastSent', { name: selected.name }));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'network error');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('title')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : error ? (
            <p className="py-6 text-center text-sm text-red-400">{error}</p>
          ) : templates.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('empty')}
            </p>
          ) : (
            templates.map((template) => (
              <button
                key={template.id}
                onClick={() => setSelected(template)}
                className={`flex w-full flex-col gap-1 rounded-xl border p-3 text-left transition-all ${
                  selected?.id === template.id
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                    : 'border-border bg-card/50 hover:border-border hover:bg-card'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {template.name}
                  </span>
                </div>
                <span className="truncate text-xs text-muted-foreground">
                  {template.subject}
                </span>
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
            className="border-border text-muted-foreground"
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleSend}
            disabled={!selected || sending}
            className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {t('send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}