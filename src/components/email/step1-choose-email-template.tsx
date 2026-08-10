'use client';

import { useEffect, useState } from 'react';
import { EmailTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Loader2, Mail, ArrowRight, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface Step1Props {
  selectedTemplate: EmailTemplate | null;
  onSelect: (template: EmailTemplate) => void;
  onNext: () => void;
  /** Volver a la lista de campañas. */
  onBack: () => void;
  /** Abrir el editor de templates para crear uno nuevo. */
  onCreateTemplate: () => void;
}

/**
 * Paso 1 del wizard de campaña de email: elegir un template (email_templates).
 * Espejo de `Step1ChooseTemplate` (broadcast), pero para templates de email.
 */
export function Step1ChooseEmailTemplate({
  selectedTemplate,
  onSelect,
  onNext,
  onBack,
  onCreateTemplate,
}: Step1Props) {
  const t = useTranslations('EmailCampaigns.wizard');
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const res = await fetch('/api/email/templates', { cache: 'no-store' });
        const data = (await res.json()) as { templates?: EmailTemplate[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? 'failed to list');
        setTemplates(data.templates ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('chooseTemplate.errorLoad'));
      } finally {
        setLoading(false);
      }
    }

    fetchTemplates();
  }, [t]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('chooseTemplate.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('chooseTemplate.subtitle')}
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-border bg-card/50">
          <Mail className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('chooseTemplate.noTemplates')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('chooseTemplate.createFirst')}</p>
          <Button variant="outline" size="sm" onClick={onCreateTemplate} className="mt-4 border-border">
            <Pencil className="h-3.5 w-3.5" />
            {t('chooseTemplate.create')}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => {
            const isSelected = selectedTemplate?.id === template.id;
            return (
              <button
                key={template.id}
                onClick={() => onSelect(template)}
                className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                    : 'border-border bg-card/50 hover:border-border hover:bg-card'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="truncate text-sm font-medium text-foreground">{template.name}</h3>
                </div>
                <p className="truncate text-xs font-semibold text-muted-foreground">
                  {template.subject}
                </p>
                {/* Preview del body sin HTML tags, acotado. */}
                <p className="line-clamp-3 text-xs text-muted-foreground">
                  {stripHtml(template.body_html ?? '', 120)}
                </p>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack} className="border-border text-muted-foreground">
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!selectedTemplate}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** Extrae texto plano del HTML para el preview de la tarjeta. */
function stripHtml(html: string, maxLen: number): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}