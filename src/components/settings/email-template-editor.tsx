'use client';

import { useState } from 'react';
import { Pencil, Eye, SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

/**
 * Literales de variable interpolables en el cuerpo HTML del template.
 * El envío los resuelve (send_email / /api/email/send) vía contactText.
 */
const AVAILABLE_VARIABLES = [
  '{{ name }}',
  '{{ email }}',
  '{{ phone }}',
  '{{ company }}',
] as const;

interface EmailTemplateEditorProps {
  /** Nombre del template (fijo al editar — la API lo usa como clave). */
  name: string;
  subject: string;
  bodyHtml: string;
  /** Nombre bloqueado (solo lectura) al editar un template existente. */
  nameDisabled?: boolean;
  onChange: (patch: { name?: string; subject?: string; bodyHtml?: string }) => void;
}

/**
 * Editor estructurado de plantilla de email: asunto + cuerpo HTML con
 * **preview en vivo** y **inserción de variables** con un clic.
 *
 * Reemplaza el Dialog crudo con `Textarea` del HTML a mano; reutiliza el
 * patrón visual del editor de templates (subject/body/footer) que el
 * usuario prefiere en Settings > Templates, adaptado al modelo de email
 * (name/subject/body_html).
 */
export function EmailTemplateEditor({
  name,
  subject,
  bodyHtml,
  nameDisabled,
  onChange,
}: EmailTemplateEditorProps) {
  const t = useTranslations('Settings.emailTemplates');
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');

  // Derive the active tab instead of forcing it in an effect: if the body
  // is emptied while on preview, render the edit pane (the preview trigger
  // is disabled without content anyway). Keeps the composer stateless.
  const activeTab = !bodyHtml.trim() ? 'edit' : tab;

  function insertVariable(variable: string) {
    // Insert at the end of the current body; a user can move it later.
    // Simple append keeps the composer stateless and predictable.
    const next = bodyHtml ? `${bodyHtml}\n${variable}` : variable;
    onChange({ bodyHtml: next });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-muted-foreground">{t('name')}</Label>
        <Input
          value={name}
          disabled={nameDisabled}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="missed_call"
          className="bg-muted border-border text-foreground placeholder:text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
        />
        <p className="text-xs text-muted-foreground">{t('nameHint')}</p>
      </div>

      <div className="space-y-2">
        <Label className="text-muted-foreground">{t('subject')}</Label>
        <Input
          value={subject}
          onChange={(e) => onChange({ subject: e.target.value })}
          placeholder="Hola {{name}}, vimos tu llamada…"
          className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-muted-foreground">{t('bodyHtml')}</Label>
          <Tabs value={activeTab} onValueChange={(v) => setTab(v as 'edit' | 'preview')}>
            <TabsList>
              <TabsTrigger value="edit">
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                {t('editorTab')}
              </TabsTrigger>
              <TabsTrigger value="preview" disabled={!bodyHtml.trim()}>
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                {t('previewTab')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <TabsContent value="edit" className="mt-0">
          <Textarea
            value={bodyHtml}
            onChange={(e) => onChange({ bodyHtml: e.target.value })}
            rows={14}
            placeholder="<p>Hola {{name}}, …</p>"
            className="bg-muted border-border font-mono text-xs text-foreground placeholder:text-muted-foreground"
          />

          <div className="flex flex-wrap items-center gap-1.5 pt-2">
            <span className="text-xs text-muted-foreground">{t('insertVar')}</span>
            {AVAILABLE_VARIABLES.map((v) => (
              <Button
                key={v}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => insertVariable(v)}
                title={t('insertAria', { var: v })}
                className="h-7 border-border px-2 text-[11px] font-mono text-muted-foreground hover:text-primary hover:bg-primary/10"
              >
                {v}
              </Button>
            ))}
          </div>
          <p className="pt-2 text-xs text-muted-foreground">{t('varsHint')}</p>
        </TabsContent>

        <TabsContent value="preview" className="space-y-2">
          {bodyHtml.trim() ? (
            <div className="overflow-hidden rounded-md border border-border bg-card">
              <div className="border-b border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                {subject || t('previewSubjectFallback')}
              </div>
              {/* srcdoc aislado del CSS global del dashboard — preview del
                  template como lo vería el cliente en su cliente de correo. */}
              <iframe
                title={t('previewFrame')}
                srcDoc={`<!doctype html><html><head><meta charset="utf-8"/></head><body>${bodyHtml}</body></html>`}
                sandbox=""
                className="h-72 w-full bg-white"
              />
            </div>
          ) : (
            <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border text-muted-foreground">
              <SearchX className="h-5 w-5" />
              <p className="text-sm">{t('previewEmpty')}</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('previewHint')}</p>
        </TabsContent>
      </div>
    </div>
  );
}