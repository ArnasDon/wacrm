'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Contact, EmailTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Eye, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { contactText } from '@/lib/automations/engine';
import type { VariableMapping } from '@/lib/campaigns/types';

interface Step3Props {
  template: EmailTemplate;
  variables: Record<string, VariableMapping>;
  onNext: () => void;
  onBack: () => void;
}

const SAMPLE_CONTACT: Contact = {
  id: 'sample',
  user_id: '',
  account_id: '',
  name: 'John Doe',
  phone: '+1234567890',
  email: 'john@example.com',
  company: 'Acme Corp',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

/**
 * Paso 3 del wizard de campaña de email: preview del email renderizado.
 *
 * Los templates de email NO llevan placeholders numerados como broadcast:
 * `contactText` resuelve `{{name}}`, `{{email}}`, `{{phone}}`, `{{company}}`
 * de forma automática (única fuente de campos, §9.3.1). Por eso este paso
 * es de revisión: muestra subject + body renderizados contra el primer
 * contacto real (o sample). `variables` se conserva para round-trip futuro
 * de valores custom, aunque hoy las plantillas no las exigen.
 */
export function Step3EmailPreview({ template, variables, onNext, onBack }: Step3Props) {
  const t = useTranslations('EmailCampaigns.wizard');
  const [firstContact, setFirstContact] = useState<Contact | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setFirstContact(data ?? null);
      setLoadingPreview(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const previewSubject = useMemo(() => {
    const contact = firstContact ?? SAMPLE_CONTACT;
    return contactText(template.subject ?? '', variables, contact);
  }, [template.subject, variables, firstContact]);

  const previewBody = useMemo(() => {
    const contact = firstContact ?? SAMPLE_CONTACT;
    return contactText(template.body_html ?? '', variables, contact);
  }, [template.body_html, variables, firstContact]);

  const previewLabel = firstContact
    ? firstContact.name || firstContact.email || firstContact.phone
    : t('personalize.previewSample');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('personalize.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('personalize.subtitle')}</p>
      </div>

      {/* Live Preview — rendered email (subject + body) against the first
          real contact, falling back to sample data. */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium text-foreground">{t('personalize.preview')}</p>
          <span className="text-xs text-muted-foreground">({previewLabel})</span>
          {loadingPreview && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
        </div>
        <div className="rounded-lg bg-[#0f172a] p-3">
          <div className="mb-1 text-xs font-semibold text-slate-400">
            {t('personalize.subject')}
          </div>
          <div className="mb-3 text-sm font-medium text-white">{previewSubject}</div>
          <iframe
            title={t('personalize.previewFrame')}
            sandbox=""
            srcDoc={`<!doctype html><html><body style="margin:0;padding:16px;font-family:system-ui,sans-serif;background:#fff;color:#111">${previewBody}</body></html>`}
            className="h-64 w-full rounded-md border border-border bg-white"
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}