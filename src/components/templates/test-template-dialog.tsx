'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { isMediaHeaderKind } from '@/lib/whatsapp/media-header-types';
import { DIAL_CODES, dialCodeForLocale, splitInternational } from '@/lib/phone/dial-codes';
import { cn } from '@/lib/utils';
import { extractVariableIndices } from '@/lib/whatsapp/template-validators';
import type { MessageTemplate } from '@/types';
import type { CloneChannel } from './clone-template-dialog';
import { TemplatePreview, fillVariables } from './template-preview';
import { MessageTestingView, type TestRun } from './message-testing-view';

// Per-viewer convenience: the number last tested with.
const LAST_TO_KEY = 'wacrm.templateTest.to';

function readLastTo(): string {
  try {
    return window.localStorage.getItem(LAST_TO_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveLastTo(value: string) {
  try {
    window.localStorage.setItem(LAST_TO_KEY, value);
  } catch {
    // Storage blocked — nothing to remember, nothing breaks.
  }
}

/**
 * Send an approved template to one phone number to see it on a real
 * device. Values default to the template's sample values; the send goes
 * through a channel of the template's own WABA.
 */
export function TestTemplateDialog({
  template,
  channels,
  onClose,
}: {
  template: MessageTemplate | null;
  channels: CloneChannel[];
  onClose: () => void;
}) {
  const t = useTranslations('Settings.templates');

  // Only channels of the template's WABA can send it.
  const usable = useMemo(
    () => channels.filter((c) => !template?.waba_id || c.waba_id === template.waba_id),
    [channels, template?.waba_id],
  );

  const [channelId, setChannelId] = useState<string | null>(null);
  // Receiver = country code picker + national number. Typing a full
  // "+…" number in the number box overrides the picker.
  const [dialCode, setDialCode] = useState('+91');
  const [localNumber, setLocalNumber] = useState('');
  // Field → message, from the checks below or a 400 from the server.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bodyValues, setBodyValues] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [buttonValues, setButtonValues] = useState<Record<number, string>>({});
  // Non-null once Send is pressed: the dialog switches to the
  // "Message Testing" window (request, API response, Meta's status).
  const [run, setRun] = useState<TestRun | null>(null);
  const sending = run?.pending ?? false;

  const bodyVarCount = template ? extractVariableIndices(template.body_text ?? '').length : 0;
  const headerHasVar =
    template?.header_type === 'text' && /\{\{1\}\}/.test(template.header_content ?? '');
  const mediaHeader = isMediaHeaderKind(template?.header_type);
  const urlButtons = (template?.buttons ?? [])
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => b.type === 'URL' && /\{\{1\}\}/.test(b.url));

  // Prefill from the template's sample values each time one is opened.
  useEffect(() => {
    if (!template) return;
    setChannelId(usable[0]?.id ?? null);
    const last = splitInternational(readLastTo());
    setDialCode(
      last?.code ??
        dialCodeForLocale(typeof navigator !== 'undefined' ? navigator.language : undefined) ??
        '+91',
    );
    setLocalNumber(last?.national ?? '');
    setErrors({});
    const samples = template.sample_values?.body ?? [];
    setBodyValues(Array.from({ length: bodyVarCount }, (_, i) => samples[i] ?? ''));
    setHeaderText(template.sample_values?.header?.[0] ?? '');
    setMediaUrl(
      template.header_media_url ||
        (template.header_handle && /^https?:\/\//i.test(template.header_handle) ? template.header_handle : ''),
    );
    const buttons: Record<number, string> = {};
    for (const { b, index } of urlButtons) {
      if (b.type === 'URL' && b.example) buttons[index] = b.example;
    }
    setButtonValues(buttons);
    setRun(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

  const to = localNumber.trim().startsWith('+')
    ? localNumber.trim()
    : `${dialCode}${localNumber.replace(/\D/g, '')}`;

  // The same rules the server applies, checked before anything is sent.
  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    const digits = to.replace(/\D/g, '');
    if (!localNumber.trim()) next.to = t('testErrNumberRequired');
    else if (digits.length < 8 || digits.length > 15) next.to = t('testErrNumberInvalid');
    if (bodyValues.some((v) => !v.trim())) next.body = t('testErrVarsRequired');
    if (headerHasVar && !headerText.trim()) next.header_text = t('testErrHeaderRequired');
    if (mediaHeader && !/^https?:\/\/\S+$/i.test(mediaUrl.trim())) next.header_media_url = t('testErrMediaRequired');
    return next;
  }

  async function send() {
    if (!template) return;
    const problems = validate();
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setRun({ to, pending: true });
    try {
      const res = await fetch(`/api/whatsapp/templates/${template.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          channel_id: channelId ?? undefined,
          body: bodyValues,
          header_text: headerHasVar ? headerText : undefined,
          header_media_url: mediaHeader ? mediaUrl : undefined,
          button_params: buttonValues,
        }),
      });
      const data = await res.json().catch(() => ({}));
      // A field problem the server caught: back to the form, shown there.
      if (res.status === 400 && typeof data?.field === 'string') {
        setRun(null);
        setErrors({ [data.field]: data.error });
        return;
      }
      if (res.ok) saveLastTo(to);
      setRun({
        to: data.to ?? to,
        response: data.response,
        wamid: res.ok ? (data.message_id ?? null) : null,
        error: res.ok ? undefined : data?.error || t('testFailedHttp', { status: res.status }),
        pending: false,
      });
    } catch (err) {
      setRun({ to, pending: false, error: err instanceof Error ? err.message : t('testFailed') });
    }
  }

  return (
    <Dialog open={template !== null} onOpenChange={(open) => !open && !sending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500">
              <Send className="size-4" />
            </span>
            {run ? t('testingTitle') : t('testDialogTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {run
              ? t('testingDesc', { name: template?.name ?? '' })
              : t('testDialogDesc', { name: template?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>

        {run ? (
          <MessageTestingView
            key={run.wamid ?? 'pending'}
            run={run}
            onClose={onClose}
            onReset={() => setRun(null)}
          />
        ) : (

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {/* WhatsApp-style preview of what the recipient will see. */}
          {template ? (
            <div className="max-h-64 overflow-y-auto rounded-xl">
              <TemplatePreview
                headerType={template.header_type}
                headerText={fillVariables(template.header_content ?? '', [headerText])}
                mediaUrl={mediaUrl || null}
                body={fillVariables(template.body_text ?? '', bodyValues)}
                footer={template.footer_text}
                buttons={template.buttons}
                mediaLabel={t('testMediaPlaceholder', { kind: template.header_type ?? '' })}
              />
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="test-to" className="text-muted-foreground">
                {t('testTo')}
              </Label>
              <div
                className={cn(
                  'flex h-8 overflow-hidden rounded-lg border bg-muted focus-within:ring-3 focus-within:ring-ring/50',
                  errors.to ? 'border-red-500' : 'border-border',
                )}
              >
                <select
                  aria-label={t('testCountryCode')}
                  value={dialCode}
                  onChange={(e) => setDialCode(e.target.value)}
                  disabled={localNumber.trim().startsWith('+')}
                  className="h-full shrink-0 border-r border-border bg-transparent pr-1 pl-2 text-sm text-foreground outline-none disabled:opacity-50"
                >
                  {DIAL_CODES.map((d) => (
                    <option key={d.region} value={d.code}>
                      {d.flag} {d.code}
                    </option>
                  ))}
                </select>
                <input
                  id="test-to"
                  type="tel"
                  inputMode="tel"
                  autoFocus
                  autoComplete="tel-national"
                  placeholder="99725 19911"
                  value={localNumber}
                  onChange={(e) => setLocalNumber(e.target.value)}
                  className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
              <FieldError message={errors.to} />
            </div>
            {usable.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="test-channel" className="text-muted-foreground">
                  {t('testFrom')}
                </Label>
                <select
                  id="test-channel"
                  value={channelId ?? ''}
                  onChange={(e) => setChannelId(e.target.value || null)}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                >
                  {usable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.verified_name || c.display_phone_number || c.id}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          {headerHasVar ? (
            <div className="space-y-1.5">
              <Label htmlFor="test-header" className="text-muted-foreground">
                {t('testHeaderVar')}
              </Label>
              <Input
                id="test-header"
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                className={cn('border-border bg-muted text-foreground', errors.header_text && 'border-red-500')}
              />
              <FieldError message={errors.header_text} />
            </div>
          ) : null}

          {mediaHeader ? (
            <div className="space-y-1.5">
              <Label htmlFor="test-media" className="text-muted-foreground">
                {t('testMediaUrl')}
              </Label>
              <Input
                id="test-media"
                type="url"
                placeholder="https://…"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                className={cn('border-border bg-muted text-foreground', errors.header_media_url && 'border-red-500')}
              />
              <FieldError message={errors.header_media_url} />
            </div>
          ) : null}

          {bodyVarCount > 0 ? (
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('testBodyVars')}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {bodyValues.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-9 shrink-0 font-mono text-xs text-muted-foreground">{`{{${i + 1}}}`}</span>
                    <Input
                      value={v}
                      aria-label={t('testVarN', { n: i + 1 })}
                      onChange={(e) =>
                        setBodyValues((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))
                      }
                      className={cn(
                        'h-8 border-border bg-muted text-foreground',
                        errors.body && !v.trim() && 'border-red-500',
                      )}
                    />
                  </div>
                ))}
              </div>
              <FieldError message={errors.body} />
            </div>
          ) : null}

          {urlButtons.map(({ b, index }) => (
            <div key={index} className="space-y-1.5">
              <Label className="text-muted-foreground">{t('testButtonVar', { text: b.text })}</Label>
              <Input
                value={buttonValues[index] ?? ''}
                onChange={(e) => setButtonValues((prev) => ({ ...prev, [index]: e.target.value }))}
                className="h-8 border-border bg-muted text-foreground"
              />
            </div>
          ))}


          <DialogFooter className="border-border bg-popover">
            <Button type="button" variant="outline" onClick={onClose} disabled={sending}>
              {t('cloneClose')}
            </Button>
            <Button type="submit" disabled={sending || usable.length === 0}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {sending ? t('testSending') : t('testSend')}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-500">{message}</p>;
}
