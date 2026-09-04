'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Save, Send, Server } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { EmailNav } from '@/components/email/email-nav';
import { ListmonkGate } from '@/components/email/listmonk-status';
import type { EmailSettings } from '@/lib/listmonk/settings';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export default function EmailSettingsPage() {
  const t = useTranslations('Email.settings');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>
      <EmailNav />
      <ListmonkGate>{() => <SettingsForm />}</ListmonkGate>
    </div>
  );
}

const TLS_TYPES = ['none', 'STARTTLS', 'TLS'] as const;
const AUTH_PROTOCOLS = ['plain', 'login', 'cram', 'none'] as const;

function SettingsForm() {
  const t = useTranslations('Email.settings');
  const canEdit = useCan('edit-settings');

  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');

  useEffect(() => {
    fetch('/api/email/settings')
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? 'Failed to load');
        setSettings(d.settings);
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  function patch(fields: Partial<EmailSettings>) {
    setSettings((s) => (s ? { ...s, ...fields } : s));
  }
  function patchSmtp(fields: Partial<EmailSettings['smtp']>) {
    setSettings((s) => (s ? { ...s, smtp: { ...s.smtp, ...fields } } : s));
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/email/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Save failed');
      // The engine rebuilds its SMTP pool on save, which means a short
      // restart. Say so rather than letting the next action fail
      // mysteriously against a door that is briefly shut.
      toast.success(t('saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!settings) return;
    if (!testTo.trim()) {
      toast.error(t('testEmailRequired'));
      return;
    }
    setTesting(true);
    try {
      const res = await fetch('/api/email/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testTo.trim(), smtp: settings.smtp }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Test failed');
      toast.success(t('testSent', { email: testTo.trim() }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  if (loading || !settings) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <section className="border-border bg-card space-y-4 rounded-xl border p-5">
          <div className="flex items-center gap-2">
            <Server className="text-primary h-4 w-4" />
            <h2 className="text-foreground text-sm font-semibold">
              {t('smtpHeading')}
            </h2>
          </div>
          <p className="text-muted-foreground text-xs">{t('smtpHelp')}</p>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="host">{t('host')}</Label>
              <Input
                id="host"
                value={settings.smtp.host}
                disabled={!canEdit}
                onChange={(e) => patchSmtp({ host: e.target.value })}
                placeholder="email-smtp.us-east-1.amazonaws.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="port">{t('port')}</Label>
              <Input
                id="port"
                type="number"
                value={settings.smtp.port}
                disabled={!canEdit}
                onChange={(e) => patchSmtp({ port: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="username">{t('username')}</Label>
              <Input
                id="username"
                value={settings.smtp.username}
                disabled={!canEdit}
                onChange={(e) => patchSmtp({ username: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('password')}</Label>
              <Input
                id="password"
                type="password"
                value={settings.smtp.password}
                disabled={!canEdit}
                onChange={(e) => patchSmtp({ password: e.target.value })}
                autoComplete="new-password"
              />
              <p className="text-muted-foreground text-xs">
                {t('passwordHelp')}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tls">{t('encryption')}</Label>
              <select
                id="tls"
                value={settings.smtp.tls_type}
                disabled={!canEdit}
                onChange={(e) =>
                  patchSmtp({
                    tls_type: e.target
                      .value as EmailSettings['smtp']['tls_type'],
                  })
                }
                className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              >
                {TLS_TYPES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="auth">{t('authProtocol')}</Label>
              <select
                id="auth"
                value={settings.smtp.auth_protocol}
                disabled={!canEdit}
                onChange={(e) =>
                  patchSmtp({
                    auth_protocol: e.target
                      .value as EmailSettings['smtp']['auth_protocol'],
                  })
                }
                className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              >
                {AUTH_PROTOCOLS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={settings.smtp.tls_skip_verify}
              disabled={!canEdit}
              onCheckedChange={(v) =>
                patchSmtp({ tls_skip_verify: Boolean(v) })
              }
            />
            <span className="text-muted-foreground">{t('skipVerify')}</span>
          </label>
        </section>

        <section className="border-border bg-card space-y-4 rounded-xl border p-5">
          <h2 className="text-foreground text-sm font-semibold">
            {t('senderHeading')}
          </h2>
          <div className="space-y-2">
            <Label htmlFor="from">{t('fromEmail')}</Label>
            <Input
              id="from"
              value={settings.fromEmail}
              disabled={!canEdit}
              onChange={(e) => patch({ fromEmail: e.target.value })}
              placeholder="Your Company <hello@yourdomain.com>"
            />
            <p className="text-muted-foreground text-xs">{t('fromHelp')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rootUrl">{t('rootUrl')}</Label>
            <Input
              id="rootUrl"
              value={settings.rootUrl}
              disabled={!canEdit}
              onChange={(e) => patch({ rootUrl: e.target.value })}
              placeholder="https://crm.example.com"
            />
            <p className="text-muted-foreground text-xs">{t('rootUrlHelp')}</p>
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <div className="border-border bg-card space-y-3 rounded-xl border p-4">
          <Label htmlFor="testTo">{t('testHeading')}</Label>
          <p className="text-muted-foreground text-xs">{t('testHelp')}</p>
          <Input
            id="testTo"
            value={testTo}
            disabled={!canEdit}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="you@yourdomain.com"
          />
          <Button
            variant="outline"
            className="w-full"
            disabled={!canEdit || testing}
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
        {!canEdit && (
          <p className="text-muted-foreground text-center text-xs">
            {t('readOnly')}
          </p>
        )}
      </div>
    </div>
  );
}
