'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Contact, CustomField, MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Eye,
  FileText,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  TemplatePreview,
  fillVariables,
} from '@/components/templates/template-preview';
import { MediaField } from '@/components/campaigns/advanced/step-variables';
import { useTranslations } from 'next-intl';
import { WizardFooter } from '@/components/campaigns/wizard-shell';

type VariableType = 'static' | 'field' | 'custom_field';

interface VariableMapping {
  type: VariableType;
  value: string;
}

interface Step3Props {
  template: MessageTemplate;
  variables: Record<string, VariableMapping>;
  onUpdate: (variables: Record<string, VariableMapping>) => void;
  /** Media URL for an IMAGE/VIDEO/DOCUMENT header, when the template has one. */
  headerMediaUrl: string;
  onHeaderMediaUrlChange: (url: string) => void;
  onNext: () => void;
  onBack: () => void;
}

const MEDIA_HEADER_TYPES = ['image', 'video', 'document'] as const;
type MediaHeaderType = (typeof MEDIA_HEADER_TYPES)[number];

function isMediaHeaderType(value: unknown): value is MediaHeaderType {
  return MEDIA_HEADER_TYPES.includes(value as MediaHeaderType);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const contactFields = [
  { value: 'name', labelKey: 'name' },
  { value: 'phone', labelKey: 'phone' },
  { value: 'email', labelKey: 'email' },
];

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

export function Step3Personalize({
  template,
  variables,
  onUpdate,
  headerMediaUrl,
  onHeaderMediaUrlChange,
  onNext,
  onBack,
}: Step3Props) {
  const t = useTranslations('Broadcasts.wizard');
  const tv = useTranslations('Broadcasts.advanced');
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [firstContact, setFirstContact] = useState<Contact | null>(null);
  const [firstContactCustomValues, setFirstContactCustomValues] = useState<
    Map<string, string>
  >(new Map());
  const [loadingPreview, setLoadingPreview] = useState(true);

  // Load user's custom fields + a representative contact for the
  // live preview. Fall back to sample data if no contacts exist yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [fieldsRes, contactRes] = await Promise.all([
        supabase.from('custom_fields').select('*').order('field_name'),
        supabase
          .from('contacts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;

      setCustomFields(fieldsRes.data ?? []);
      setLoadingFields(false);

      const contact = contactRes.data ?? null;
      setFirstContact(contact);

      if (contact) {
        const { data: customVals } = await supabase
          .from('contact_custom_values')
          .select('custom_field_id, value')
          .eq('contact_id', contact.id);
        if (!cancelled) {
          const map = new Map<string, string>();
          for (const row of customVals ?? []) {
            map.set(row.custom_field_id, row.value ?? '');
          }
          setFirstContactCustomValues(map);
        }
      }
      setLoadingPreview(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const placeholders = useMemo(() => {
    const matches = template.body_text.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches)].sort();
  }, [template.body_text]);

  // Templates with an IMAGE/VIDEO/DOCUMENT header need a media URL at
  // send time — Meta requires the media component on every delivery and
  // rejects the broadcast without it. The field is hidden for text-only
  // headers.
  const mediaHeaderType = isMediaHeaderType(template.header_type)
    ? template.header_type
    : null;

  const headerMediaError = useMemo<'missing' | 'invalid' | null>(() => {
    if (!mediaHeaderType) return null;
    const value = headerMediaUrl.trim();
    // Empty = the template's own media (the server falls back to it).
    if (!value) return template.header_media_url ? null : 'missing';
    if (!isValidHttpUrl(value)) return 'invalid';
    return null;
  }, [mediaHeaderType, headerMediaUrl, template.header_media_url]);

  /**
   * A placeholder is "unmapped" if the user hasn't picked either a
   * static value or a field/custom-field source. Blocks Next until
   * every placeholder has something — otherwise the broadcast would
   * ship with empty strings and confuse recipients.
   */
  const unmappedKeys = useMemo(() => {
    const missing: string[] = [];
    for (const placeholder of placeholders) {
      const key = placeholder.replace(/^\{\{|\}\}$/g, '');
      const mapping = variables[key];
      if (!mapping || !mapping.value?.trim()) {
        missing.push(placeholder);
      }
    }
    return missing;
  }, [placeholders, variables]);

  function updateVariable(key: string, patch: Partial<VariableMapping>) {
    const current = variables[key] ?? {
      type: 'static' as VariableType,
      value: '',
    };
    onUpdate({
      ...variables,
      [key]: { ...current, ...patch },
    });
  }

  /**
   * Value of each {{N}} for the preview, from the first real contact
   * (sample data when there are none). Unmapped ones stay as {{N}}.
   */
  const previewValues = useMemo(() => {
    const contact = firstContact ?? SAMPLE_CONTACT;
    const customValues = firstContact
      ? firstContactCustomValues
      : new Map<string, string>();
    const max = Math.max(
      0,
      ...placeholders.map((p) => Number(p.replace(/\D/g, '')))
    );
    return Array.from({ length: max }, (_, i) => {
      const mapping = variables[String(i + 1)];
      if (!mapping?.value) return undefined;
      if (mapping.type === 'static') return mapping.value;
      if (mapping.type === 'field') {
        const fieldMap: Record<string, string | undefined> = {
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          company: contact.company,
        };
        return fieldMap[mapping.value];
      }
      return customValues.get(mapping.value);
    });
  }, [variables, placeholders, firstContact, firstContactCustomValues]);

  const previewLabel = firstContact
    ? firstContact.name || firstContact.phone
    : t('personalize.previewSample');

  const selectClass = 'border-border bg-background text-foreground w-full';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t('personalize.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('personalize.subtitle')}
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="border-border bg-card overflow-hidden rounded-xl border">
          <header className="border-border flex flex-wrap items-center gap-2 border-b px-5 py-3">
            <FileText className="text-primary size-4" />
            <p className="text-foreground font-medium">{template.name}</p>
            <span className="text-muted-foreground font-mono text-xs">
              {template.language ?? 'en_US'}
            </span>
            <span className="bg-muted text-muted-foreground ml-auto rounded-full px-2 py-0.5 text-xs">
              {template.category}
            </span>
          </header>

          <div className="space-y-5 p-5">
            {mediaHeaderType ? (
              <MediaField
                label={t('personalize.headerImage')}
                hint={t('personalize.headerImageDesc')}
                kind={mediaHeaderType}
                value={headerMediaUrl}
                fallback={template.header_media_url}
                onChange={onHeaderMediaUrlChange}
              />
            ) : null}
            {headerMediaError ? (
              <p className="-mt-3 text-xs text-amber-700 dark:text-amber-400">
                {headerMediaError === 'missing'
                  ? t('personalize.mediaUrlRequired')
                  : t('personalize.mediaUrlInvalid')}
              </p>
            ) : null}

            {placeholders.length === 0 && !mediaHeaderType ? (
              <p className="text-muted-foreground text-sm">
                {t('personalize.noPreview')}
              </p>
            ) : null}

            {placeholders.map((placeholder) => {
              const key = placeholder.replace(/^\{\{|\}\}$/g, '');
              const mapping = variables[key] ?? { type: 'static', value: '' };
              const missing = !mapping.value?.trim();
              return (
                <div key={placeholder}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-foreground text-sm font-medium">
                      {tv('variables.variable', { n: key })}
                    </span>
                    <code className="bg-primary/10 text-primary rounded px-1.5 py-px font-mono text-xs">
                      {placeholder}
                    </code>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
                    <Select
                      value={mapping.type}
                      onValueChange={(val) =>
                        updateVariable(key, {
                          type: val as VariableType,
                          value: '',
                        })
                      }
                    >
                      <SelectTrigger className={selectClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-border bg-popover">
                        <SelectItem value="static">
                          {t('personalize.typeStatic')}
                        </SelectItem>
                        <SelectItem value="field">
                          {t('personalize.typeContact')}
                        </SelectItem>
                        <SelectItem value="custom_field">
                          {t('personalize.typeCustom')}
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    {mapping.type === 'static' ? (
                      <Input
                        value={mapping.value}
                        onChange={(e) =>
                          updateVariable(key, { value: e.target.value })
                        }
                        placeholder={t('personalize.enterValue')}
                        aria-invalid={missing}
                        className={cn(
                          'bg-background text-foreground placeholder:text-muted-foreground',
                          missing ? 'border-amber-500/60' : 'border-border'
                        )}
                      />
                    ) : mapping.type === 'field' ? (
                      <Select
                        value={mapping.value || null}
                        onValueChange={(val) =>
                          updateVariable(key, { value: val || '' })
                        }
                      >
                        <SelectTrigger className={selectClass}>
                          <SelectValue
                            placeholder={t('personalize.selectContactField')}
                          />
                        </SelectTrigger>
                        <SelectContent className="border-border bg-popover">
                          {contactFields.map((field) => (
                            <SelectItem key={field.value} value={field.value}>
                              {t(`personalize.fieldMap.${field.labelKey}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select
                        value={mapping.value || null}
                        onValueChange={(val) =>
                          updateVariable(key, { value: val || '' })
                        }
                      >
                        <SelectTrigger className={selectClass}>
                          <SelectValue
                            placeholder={
                              loadingFields
                                ? t('personalize.loadingFields')
                                : customFields.length === 0
                                  ? t('personalize.noCustomFields')
                                  : t('personalize.selectCustomField')
                            }
                          />
                        </SelectTrigger>
                        <SelectContent className="border-border bg-popover">
                          {customFields.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.field_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              );
            })}

            {unmappedKeys.length > 0 && (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {t.rich('personalize.unmappedWarning', {
                    keys: unmappedKeys.join(', '),
                    mono: (chunks) => (
                      <span className="font-mono font-semibold">{chunks}</span>
                    ),
                  })}
                </span>
              </p>
            )}
          </div>
        </section>

        {/* Live preview — the same WhatsApp bubble as the advanced wizard. */}
        <section className="border-border bg-card rounded-xl border p-4 lg:sticky lg:top-0">
          <div className="mb-3 flex items-center gap-2">
            <Eye className="text-primary size-4" />
            <p className="text-muted-foreground font-mono text-[11px] tracking-[0.15em] uppercase">
              {t('personalize.preview')}
            </p>
            <span className="text-muted-foreground truncate text-xs">
              · {previewLabel}
            </span>
            {loadingPreview && (
              <Loader2 className="text-primary size-3.5 animate-spin" />
            )}
          </div>
          <TemplatePreview
            headerType={template.header_type}
            headerText={
              template.header_type === 'text' ? template.header_content : null
            }
            mediaUrl={headerMediaUrl.trim() || template.header_media_url}
            body={fillVariables(template.body_text, previewValues)}
            footer={template.footer_text}
            buttons={template.buttons}
          />
        </section>
      </div>

      <WizardFooter>
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
          disabled={unmappedKeys.length > 0 || headerMediaError !== null}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </WizardFooter>
    </div>
  );
}
