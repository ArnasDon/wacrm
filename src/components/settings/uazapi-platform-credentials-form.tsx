'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

interface SettingsResponse {
  configured: boolean;
  baseUrl: string | null;
}

/**
 * Owner-only form for the platform-wide uazapi reseller credentials
 * (Server URL + Admin Token) — see migration 039 / uazapi-platform-config.ts.
 *
 * Deliberately just these two fields and nothing else: this is NOT the
 * "Chaves de API" feature (api-keys-settings.tsx), which generates keys
 * wacrm hands out to EXTERNAL callers. This form is the opposite
 * direction — credentials wacrm itself uses to call OUT to the uazapi
 * service — so it's kept as its own small component, never merged into
 * that screen.
 */
export function UazapiPlatformCredentialsForm({
  onConfigured,
  onRemoved,
}: {
  onConfigured?: () => void;
  onRemoved?: () => void;
}) {
  const t = useTranslations('Settings.whatsappUazapiPlatform');

  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [savedBaseUrl, setSavedBaseUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/uazapi/settings');
      const data = (await res.json()) as SettingsResponse;
      if (res.ok) {
        setConfigured(data.configured);
        setSavedBaseUrl(data.baseUrl);
        setBaseUrl(data.baseUrl ?? '');
        setEditing(!data.configured);
      }
    } catch {
      // Leave defaults (not configured) — the form below still lets
      // the owner try to save.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/uazapi/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // adminToken is sent blank when the owner is only editing the
        // Server URL of an already-configured setup — the route keeps
        // the existing encrypted token in that case.
        body: JSON.stringify({ baseUrl, adminToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('toastSaveFailed'));
        return;
      }
      toast.success(t('toastSaved'));
      setConfigured(true);
      setSavedBaseUrl(baseUrl);
      setAdminToken('');
      setEditing(false);
      onConfigured?.();
    } catch {
      toast.error(t('toastNetworkError'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (typeof window !== 'undefined' && !window.confirm(t('removeConfirm'))) return;
    setRemoving(true);
    try {
      const res = await fetch('/api/uazapi/settings', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('toastRemoveFailed'));
        return;
      }
      toast.success(t('toastRemoved'));
      setConfigured(false);
      setSavedBaseUrl(null);
      setBaseUrl('');
      setAdminToken('');
      setEditing(true);
      onRemoved?.();
    } catch {
      toast.error(t('toastNetworkError'));
    } finally {
      setRemoving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t('loading')}
      </div>
    );
  }

  if (configured && !editing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-400" />
            {t('configuredTitle')}
          </CardTitle>
          <CardDescription>{t('configuredDesc', { url: savedBaseUrl ?? '' })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            {t('editBtn')}
          </Button>
          <Button variant="destructive" onClick={handleRemove} disabled={removing}>
            {removing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('removing')}
              </>
            ) : (
              t('removeBtn')
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="uazapi-server-url">{t('serverUrlLabel')}</Label>
          <Input
            id="uazapi-server-url"
            type="url"
            placeholder={t('serverUrlPlaceholder')}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="uazapi-admin-token">{t('adminTokenLabel')}</Label>
          <Input
            id="uazapi-admin-token"
            type="password"
            placeholder={configured ? t('adminTokenPlaceholderSaved') : t('adminTokenPlaceholder')}
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving || !baseUrl || (!configured && !adminToken)}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('saving')}
              </>
            ) : (
              t('saveBtn')
            )}
          </Button>
          {configured ? (
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              {t('cancelBtn')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
