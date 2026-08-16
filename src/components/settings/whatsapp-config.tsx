'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  AlertTriangle,
  RotateCcw,
  Plus,
  Star,
  Pencil,
  Trash2,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';

const MASKED_TOKEN = '••••••••••••••••';

type Provider = 'meta' | 'zernio';
type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | 'zernio_api_error' | null;

interface ConfigSummary {
  id: string;
  provider: Provider;
  display_name: string | null;
  public_phone_number: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  zernio_account_id: string | null;
  status: 'connected' | 'disconnected';
  is_default: boolean;
  connected_at: string | null;
  registered_at: string | null;
  subscribed_apps_at: string | null;
  last_registration_error: string | null;
}

/**
 * Settings > WhatsApp — list of the account's connections, with an
 * add/edit form for one at a time. Multiple connections per account
 * shipped alongside migration 050; this used to be a single-connection
 * form (one row per account was a DB-level UNIQUE constraint).
 */
export function WhatsAppConfig() {
  const t = useTranslations('Settings.whatsapp');
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [configs, setConfigs] = useState<ConfigSummary[] | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  // 'list' | 'new' | <config id being edited>
  const [view, setView] = useState<'list' | 'new' | string>('list');
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/whatsapp/config');
      const data = await res.json();
      setConfigs(Array.isArray(data?.configs) ? data.configs : []);
    } catch (err) {
      console.error('Failed to load WhatsApp connections:', err);
      toast.error(t('loadFailed'));
      setConfigs([]);
    } finally {
      setLoadingList(false);
    }
  }, [t]);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoadingList(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfigs();
  }, [authLoading, profileLoading, user?.id, accountId, fetchConfigs]);

  async function handleSetDefault(id: string) {
    try {
      const res = await fetch(`/api/whatsapp/config/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t('setDefaultFailed'));
        return;
      }
      toast.success(t('setDefaultSuccess'));
      fetchConfigs();
    } catch (err) {
      console.error('Set default error:', err);
      toast.error(t('setDefaultFailed'));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('deleteConfirm'))) return;
    try {
      const res = await fetch(`/api/whatsapp/config/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t('deleteFailed'));
        return;
      }
      toast.success(t('deleteSuccess'));
      fetchConfigs();
    } catch (err) {
      console.error('Delete connection error:', err);
      toast.error(t('deleteFailed'));
    }
  }

  if (view !== 'list') {
    const editing = view !== 'new' ? (configs ?? []).find((c) => c.id === view) ?? null : null;
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setView('list')}
          className="mb-4 border-border text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
          {t('backToList')}
        </Button>
        <ConnectionForm
          configId={view === 'new' ? null : view}
          initialData={editing}
          isFirstConnection={(configs?.length ?? 0) === 0}
          onSaved={(id) => {
            setView(id);
            fetchConfigs();
          }}
          onDeleted={() => {
            setView('list');
            fetchConfigs();
          }}
        />
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-foreground">{t('listTitle')}</h3>
        <Button
          size="sm"
          onClick={() => setView('new')}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Plus className="size-4" />
          {t('addConnection')}
        </Button>
      </div>

      {loadingList ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : !configs || configs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('noConnections')}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {configs.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  {c.status === 'connected' ? (
                    <CheckCircle2 className="size-4 text-primary shrink-0" />
                  ) : (
                    <XCircle className="size-4 text-red-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground truncate">
                        {c.display_name || c.phone_number_id || c.zernio_account_id || c.id}
                      </span>
                      {c.is_default && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          <Star className="size-2.5" />
                          {t('defaultBadge')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.provider === 'zernio' ? t('providerZernio') : t('providerMeta')}
                      {c.phone_number_id ? ` · ${c.phone_number_id}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!c.is_default && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSetDefault(c.id)}
                      className="border-border text-muted-foreground hover:bg-muted"
                    >
                      <Star className="size-3.5" />
                      {t('setAsDefault')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setView(c.id)}
                    className="border-border text-muted-foreground hover:bg-muted"
                  >
                    <Pencil className="size-3.5" />
                    {t('edit')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(c.id)}
                    className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
                  >
                    <Trash2 className="size-3.5" />
                    {t('delete')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function ConnectionForm({
  configId,
  initialData,
  isFirstConnection,
  onSaved,
  onDeleted,
}: {
  configId: string | null;
  initialData: ConfigSummary | null;
  isFirstConnection: boolean;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations('Settings.whatsapp');
  const isEditing = configId != null;

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const [provider, setProvider] = useState<Provider>(initialData?.provider ?? 'meta');
  const [displayName, setDisplayName] = useState(initialData?.display_name ?? '');
  const [publicPhoneNumber, setPublicPhoneNumber] = useState(initialData?.public_phone_number ?? '');
  const [makeDefault, setMakeDefault] = useState(isFirstConnection || initialData?.is_default || false);

  const [phoneNumberId, setPhoneNumberId] = useState(initialData?.phone_number_id ?? '');
  const [wabaId, setWabaId] = useState(initialData?.waba_id ?? '');
  const [accessToken, setAccessToken] = useState(isEditing ? MASKED_TOKEN : '');
  const [verifyToken, setVerifyToken] = useState('');
  const [pin, setPin] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  const [zernioAccountId, setZernioAccountId] = useState(initialData?.zernio_account_id ?? '');
  const [zernioApiKey, setZernioApiKey] = useState(isEditing ? MASKED_TOKEN : '');
  const [zernioApiKeyEdited, setZernioApiKeyEdited] = useState(false);
  const [showZernioApiKey, setShowZernioApiKey] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);

  const isRegistered = Boolean(initialData?.registered_at);
  const lastRegistrationError = initialData?.last_registration_error ?? null;

  const [verifyingRegistration, setVerifyingRegistration] = useState(false);
  type RegistrationProbe = {
    live: boolean;
    checks: Record<string, boolean | null>;
    errors?: string[];
  };
  const [registrationProbe, setRegistrationProbe] = useState<RegistrationProbe | null>(null);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook${provider === 'zernio' ? '/zernio' : ''}`
      : '';

  const runHealthCheck = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/whatsapp/config/${id}`, { method: 'GET' });
      const payload = await res.json();
      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
      } else {
        setConnectionStatus('disconnected');
        setResetReason(
          payload.needs_reset
            ? 'token_corrupted'
            : payload.reason === 'meta_api_error'
              ? 'meta_api_error'
              : payload.reason === 'zernio_api_error'
                ? 'zernio_api_error'
                : null,
        );
        setStatusMessage(payload.message || '');
      }
    } catch (err) {
      console.error('Health check failed:', err);
      setConnectionStatus('disconnected');
    }
  }, []);

  useEffect(() => {
    if (configId) runHealthCheck(configId);
  }, [configId, runHealthCheck]);

  async function handleSave() {
    if (provider === 'zernio') {
      await handleSaveZernio();
    } else {
      await handleSaveMeta();
    }
  }

  async function handleSaveMeta() {
    if (!phoneNumberId.trim()) {
      toast.error(t('phoneNumberIdRequired'));
      return;
    }
    if (!isEditing && (!accessToken.trim() || !tokenEdited)) {
      toast.error(t('accessTokenRequired'));
      return;
    }

    try {
      setSaving(true);

      const payload: Record<string, unknown> = {
        provider: 'meta',
        display_name: displayName.trim() || null,
        public_phone_number: publicPhoneNumber.trim() || null,
        is_default: makeDefault,
      };

      if (!isEditing || tokenEdited) {
        payload.phone_number_id = phoneNumberId.trim();
        payload.waba_id = wabaId.trim() || null;
        payload.verify_token = verifyToken.trim() || null;
        payload.pin = pin.trim() || null;
        if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
          payload.access_token = accessToken.trim();
        } else if (isEditing) {
          toast.error(t('accessTokenRequired'));
          setSaving(false);
          return;
        }
      }

      const res = await fetch(
        isEditing ? `/api/whatsapp/config/${configId}` : '/api/whatsapp/config',
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || t('saveFailed'));
        setSaving(false);
        return;
      }

      if (data.registered === false && data.registration_error) {
        toast.error(t('savedRegistrationFailed', { error: data.registration_error }), {
          duration: 12000,
        });
      } else if (data.registration_skipped) {
        toast.success(t('savedRegistrationSkipped'), { duration: 10000 });
        setPin('');
      } else {
        toast.success(
          data.phone_info?.verified_name
            ? t('savedLive', { name: data.phone_info.verified_name })
            : t('savedConnected'),
        );
        setPin('');
      }

      onSaved(data.id ?? configId ?? '');
    } catch (err) {
      console.error('Save error:', err);
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveZernio() {
    if (!zernioAccountId.trim()) {
      toast.error(t('zernioAccountIdRequired'));
      return;
    }
    if (!isEditing && (!zernioApiKey.trim() || !zernioApiKeyEdited)) {
      toast.error(t('zernioApiKeyRequired'));
      return;
    }

    try {
      setSaving(true);

      const payload: Record<string, unknown> = {
        provider: 'zernio',
        display_name: displayName.trim() || null,
        public_phone_number: publicPhoneNumber.trim() || null,
        is_default: makeDefault,
        zernio_account_id: zernioAccountId.trim(),
      };

      if (zernioApiKeyEdited && zernioApiKey !== MASKED_TOKEN && zernioApiKey.trim()) {
        payload.zernio_api_key = zernioApiKey.trim();
      } else if (isEditing) {
        toast.error(t('zernioApiKeyRequired'));
        setSaving(false);
        return;
      }

      const res = await fetch(
        isEditing ? `/api/whatsapp/config/${configId}` : '/api/whatsapp/config',
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || t('saveFailed'));
        setSaving(false);
        return;
      }

      if (data.webhook_secret) {
        setWebhookSecret(data.webhook_secret);
      }

      toast.success(
        data.phone_info?.verified_name
          ? t('zernioSavedConnected', { name: data.phone_info.verified_name })
          : t('zernioSavedGeneric'),
      );

      onSaved(data.id ?? configId ?? '');
    } catch (err) {
      console.error('Save error:', err);
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    if (!configId) return;
    try {
      setTesting(true);
      await runHealthCheck(configId);
      toast.success(t('testConnectionTriggered'));
    } finally {
      setTesting(false);
    }
  }

  async function handleVerifyRegistration() {
    if (!configId) return;
    setVerifyingRegistration(true);
    setRegistrationProbe(null);
    try {
      const res = await fetch(`/api/whatsapp/config/${configId}/verify-registration`, {
        method: 'GET',
      });
      const data = (await res.json()) as RegistrationProbe;
      setRegistrationProbe(data);
      if (data.live) {
        toast.success(t('verifyLive'));
      } else {
        toast.error(t('verifyNotLive'), { duration: 8000 });
      }
    } catch (err) {
      console.error('verify-registration failed:', err);
      toast.error(t('verifyUnreachable'));
    } finally {
      setVerifyingRegistration(false);
    }
  }

  async function handleDelete() {
    if (!configId) return;
    if (!confirm(t('deleteConfirm'))) return;
    try {
      setDeleting(true);
      const res = await fetch(`/api/whatsapp/config/${configId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('deleteFailed'));
        return;
      }
      toast.success(t('deleteSuccess'));
      onDeleted();
    } catch (err) {
      console.error('Delete error:', err);
      toast.error(t('deleteFailed'));
    } finally {
      setDeleting(false);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success(t('webhookUrlCopied'));
  }

  function handleCopyWebhookSecret() {
    if (!webhookSecret) return;
    navigator.clipboard.writeText(webhookSecret);
    toast.success(t('webhookSecretCopied'));
  }

  function handleProviderChange(next: Provider) {
    if (isEditing) return; // provider is fixed once a connection exists — delete + re-add to switch.
    if (next === provider) return;
    setProvider(next);
    setWebhookSecret(null);
  }

  const showResetBanner = resetReason === 'token_corrupted';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        {showResetBanner && (
          <Alert className="bg-amber-950/40 border-amber-600/40">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <AlertTitle className="text-amber-200 mb-1">{t('tokenCorruptedTitle')}</AlertTitle>
                <AlertDescription className="text-amber-100/80 text-sm">{statusMessage}</AlertDescription>
              </div>
            </div>
          </Alert>
        )}

        {isEditing && (
          <Alert className="bg-card border-border">
            <div className="flex items-center gap-2">
              {connectionStatus === 'connected' ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : (
                <XCircle className="size-4 text-red-500" />
              )}
              <AlertTitle className="text-foreground mb-0">
                {connectionStatus === 'connected' ? t('credentialsValid') : t('notConnected')}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground">
              {connectionStatus === 'connected'
                ? provider === 'zernio' ? t('zernioConnectedDesc') : t('connectedDesc')
                : statusMessage || t('notConnectedDesc')}
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('connectionDetailsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('displayName')}</Label>
              <Input
                placeholder={t('displayNamePlaceholder')}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">{t('displayNameHint')}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('publicPhoneNumber')}</Label>
              <Input
                placeholder={t('publicPhoneNumberPlaceholder')}
                value={publicPhoneNumber}
                onChange={(e) => setPublicPhoneNumber(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">{t('publicPhoneNumberHint')}</p>
            </div>
            {!(isFirstConnection && !isEditing) && (
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={makeDefault}
                  onChange={(e) => setMakeDefault(e.target.checked)}
                  disabled={isEditing && Boolean(initialData?.is_default)}
                  className="size-4 rounded border-border"
                />
                {t('makeDefaultConnection')}
              </label>
            )}
          </CardContent>
        </Card>

        {isEditing && provider === 'meta' && (
          <Alert
            className={
              isRegistered
                ? 'bg-emerald-950/30 border-emerald-700/50'
                : 'bg-amber-950/30 border-amber-700/50'
            }
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                {isRegistered ? (
                  <CheckCircle2 className="size-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="size-4 text-amber-400" />
                )}
                <AlertTitle className={'mb-0 ' + (isRegistered ? 'text-emerald-200' : 'text-amber-200')}>
                  {isRegistered ? t('registered') : t('notRegistered')}
                </AlertTitle>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleVerifyRegistration}
                disabled={verifyingRegistration}
                className="border-border bg-transparent text-foreground hover:bg-muted h-7"
              >
                {verifyingRegistration ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Zap className="size-3.5" />
                )}
                {t('verifyWithMeta')}
              </Button>
            </div>
            <AlertDescription className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {isRegistered ? (
                <span
                  dangerouslySetInnerHTML={{
                    __html: t('subscribedSince', {
                      date: initialData?.registered_at
                        ? new Date(initialData.registered_at).toLocaleString()
                        : t('unknownDate'),
                    }),
                  }}
                />
              ) : lastRegistrationError ? (
                <>
                  {t('lastAttemptFailed')}
                  <span className="text-red-300">&quot;{lastRegistrationError}&quot;</span>. {t('retryHint')}
                </>
              ) : (
                <>{t('noRegistrationHint')}</>
              )}
            </AlertDescription>

            {registrationProbe && (
              <div className="mt-3 rounded border border-border bg-card/60 px-3 py-2 space-y-1.5 text-[11px]">
                <p className="font-medium text-foreground">
                  {t('diagnosticLastRun')}
                  <span className={registrationProbe.live ? 'text-emerald-400' : 'text-amber-400'}>
                    {registrationProbe.live ? t('live') : t('notLive')}
                  </span>
                </p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {Object.entries(registrationProbe.checks).map(([k, v]) => (
                    <li key={k} className="flex items-center gap-1.5">
                      {v === true ? (
                        <CheckCircle2 className="size-3 text-emerald-400 shrink-0" />
                      ) : v === false ? (
                        <XCircle className="size-3 text-red-400 shrink-0" />
                      ) : (
                        <span className="size-3 rounded-full border border-border shrink-0" />
                      )}
                      <code className="text-muted-foreground">{k}</code>
                    </li>
                  ))}
                </ul>
                {(registrationProbe.errors ?? []).length > 0 && (
                  <ul className="pt-1 space-y-0.5 text-red-300">
                    {registrationProbe.errors?.map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('providerSectionTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">{t('providerSectionDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => handleProviderChange('meta')}
                disabled={isEditing}
                className={`text-left rounded-lg border p-3 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                  provider === 'meta' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                }`}
              >
                <div className="font-medium text-foreground">{t('providerMeta')}</div>
                <div className="text-xs text-muted-foreground mt-1">{t('providerMetaDesc')}</div>
              </button>
              <button
                type="button"
                onClick={() => handleProviderChange('zernio')}
                disabled={isEditing}
                className={`text-left rounded-lg border p-3 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                  provider === 'zernio' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                }`}
              >
                <div className="font-medium text-foreground">{t('providerZernio')}</div>
                <div className="text-xs text-muted-foreground mt-1">{t('providerZernioDesc')}</div>
              </button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('apiCredentialsTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {provider === 'zernio' ? t('zernioApiCredentialsDesc') : t('apiCredentialsDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {provider === 'meta' ? (
              <>
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('phoneNumberId')}</Label>
                  <Input
                    placeholder="e.g. 100234567890123"
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('wabaId')}</Label>
                  <Input
                    placeholder="e.g. 100234567890456"
                    value={wabaId}
                    onChange={(e) => setWabaId(e.target.value)}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('accessToken')}</Label>
                  <div className="relative">
                    <Input
                      type={showToken ? 'text' : 'password'}
                      placeholder={t('accessTokenPlaceholder')}
                      value={accessToken}
                      onChange={(e) => {
                        setAccessToken(e.target.value);
                        setTokenEdited(true);
                      }}
                      onFocus={() => {
                        if (accessToken === MASKED_TOKEN) {
                          setAccessToken('');
                          setTokenEdited(true);
                        }
                      }}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {isEditing && !tokenEdited && (
                    <p className="text-xs text-muted-foreground">{t('tokenHidden')}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('webhookVerifyToken')}</Label>
                  <Input
                    placeholder={t('webhookVerifyTokenPlaceholder')}
                    value={verifyToken}
                    onChange={(e) => setVerifyToken(e.target.value)}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">{t('webhookVerifyTokenHint')}</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">
                    {t('twoStepPin')}
                    <span className="ml-1 text-muted-foreground">{t('optional')}</span>
                  </Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder={t('pinPlaceholder')}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground tracking-widest"
                  />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span dangerouslySetInnerHTML={{ __html: t('pinHint') }} />
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('zernioAccountId')}</Label>
                  <Input
                    placeholder={t('zernioAccountIdPlaceholder')}
                    value={zernioAccountId}
                    onChange={(e) => setZernioAccountId(e.target.value)}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">{t('zernioAccountIdHint')}</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('zernioApiKey')}</Label>
                  <div className="relative">
                    <Input
                      type={showZernioApiKey ? 'text' : 'password'}
                      placeholder={t('zernioApiKeyPlaceholder')}
                      value={zernioApiKey}
                      onChange={(e) => {
                        setZernioApiKey(e.target.value);
                        setZernioApiKeyEdited(true);
                      }}
                      onFocus={() => {
                        if (zernioApiKey === MASKED_TOKEN) {
                          setZernioApiKey('');
                          setZernioApiKeyEdited(true);
                        }
                      }}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowZernioApiKey(!showZernioApiKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showZernioApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {isEditing && !zernioApiKeyEdited && (
                    <p className="text-xs text-muted-foreground">{t('tokenHidden')}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{t('zernioApiKeyHint')}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('webhookTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {provider === 'zernio' ? t('zernioWebhookDesc') : t('webhookDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('webhookUrl')}</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={webhookUrl}
                  className="bg-muted border-border text-muted-foreground font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyWebhookUrl}
                  className="shrink-0 border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>

            {provider === 'zernio' && (
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('webhookSecretLabel')}</Label>
                {webhookSecret ? (
                  <>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={webhookSecret}
                        className="bg-muted border-border text-muted-foreground font-mono text-sm"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleCopyWebhookSecret}
                        className="shrink-0 border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                      >
                        <Copy className="size-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-amber-400">{t('webhookSecretGenerated')}</p>
                  </>
                ) : (
                  isEditing && <p className="text-xs text-muted-foreground">{t('webhookSecretAlreadySet')}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('saving')}
              </>
            ) : (
              t('saveConfig')
            )}
          </Button>
          {isEditing && (
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              {testing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('testing')}
                </>
              ) : (
                <>
                  <Zap className="size-4" />
                  {t('testConnection')}
                </>
              )}
            </Button>
          )}
          {isEditing && (
            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={deleting}
              className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('deleting')}
                </>
              ) : (
                <>
                  <RotateCcw className="size-4" />
                  {t('deleteConnection')}
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      <div>
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground text-base">{t('setupInstructions')}</CardTitle>
            <CardDescription className="text-muted-foreground">{t('setupInstructionsDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {provider === 'meta' ? (
              <Accordion>
                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                      {t('step1')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li dangerouslySetInnerHTML={{ __html: t('step1_1') }} />
                      <li>{t('step1_2')}</li>
                      <li>{t('step1_3')}</li>
                      <li>{t('step1_4')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                      {t('step2')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('step2_1')}</li>
                      <li>{t('step2_2')}</li>
                      <li>{t('step2_3')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                      {t('step3')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('step3_1')}</li>
                      <li dangerouslySetInnerHTML={{ __html: t.raw('step3_2') }} />
                      <li dangerouslySetInnerHTML={{ __html: t.raw('step3_3') }} />
                      <li dangerouslySetInnerHTML={{ __html: t.raw('step3_4') }} />
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">4</span>
                      {t('step4')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('step4_1')}</li>
                      <li>{t('step4_2')}</li>
                      <li dangerouslySetInnerHTML={{ __html: t.raw('step4_3') }} />
                      <li dangerouslySetInnerHTML={{ __html: t.raw('step4_4') }} />
                      <li>{t('step4_5')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : (
              <Accordion>
                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                      {t('zernioStep1')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('zernioStep1_1')}</li>
                      <li>{t('zernioStep1_2')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                      {t('zernioStep2')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li dangerouslySetInnerHTML={{ __html: t.raw('zernioStep2_1') }} />
                      <li dangerouslySetInnerHTML={{ __html: t.raw('zernioStep2_2') }} />
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                      {t('zernioStep3')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li dangerouslySetInnerHTML={{ __html: t.raw('zernioStep3_1') }} />
                      <li dangerouslySetInnerHTML={{ __html: t.raw('zernioStep3_2') }} />
                      <li>{t('zernioStep3_3')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}

            <div className="mt-4 pt-4 border-t border-border">
              <a
                href={provider === 'zernio' ? 'https://docs.zernio.com' : 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                <ExternalLink className="size-3.5" />
                {provider === 'zernio' ? t('zernioDocs') : t('metaDocs')}
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
