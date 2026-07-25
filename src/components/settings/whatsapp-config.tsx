'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
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
  Lock,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { useEntitlements } from '@/hooks/use-entitlements';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';
import { whatsappNumberLimitMessage } from '@/lib/vedmint-subscription';

const MASKED_TOKEN = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | null;

export function WhatsAppConfig() {
  const supabase = createClient();
  const router = useRouter();
  // After multi-user, whatsapp_config is one-row-per-account, not
  // one-row-per-user. We pull `accountId` straight off the auth
  // context and key every read off it — so a teammate who just
  // joined an account sees the inviter's saved config without
  // having to re-enter anything.
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();
  const canEditTeam = useCan('edit-settings');
  const {
    withinLimit,
    limits,
    usage,
    loading: entitlementsLoading,
  } = useEntitlements();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfigType | null>(null);
  const [configs, setConfigs] = useState<WhatsAppConfigType[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const [displayName, setDisplayName] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [pin, setPin] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  // True once /register has succeeded on Meta's side (timestamp set
  // in the row). When false, the saved config is metadata-only and
  // Meta will silently drop every inbound event — that's the
  // multi-number bug that prompted this work.
  const isRegistered = Boolean(config?.registered_at);
  const lastRegistrationError = config?.last_registration_error ?? null;

  const [verifyingRegistration, setVerifyingRegistration] = useState(false);
  type RegistrationProbe = {
    live: boolean;
    checks: Record<string, boolean | null>;
    errors?: string[];
    last_registration_error?: string | null;
    registered_at?: string | null;
    subscribed_apps_at?: string | null;
  };
  const [registrationProbe, setRegistrationProbe] =
    useState<RegistrationProbe | null>(null);
  const [webhookSignatureReady, setWebhookSignatureReady] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const whatsappLimit = limits.max_whatsapp_numbers ?? null;
  const whatsappUsed = Math.max(
    usage.max_whatsapp_numbers ?? 0,
    configs.length,
  );
  const canAddWhatsAppNumber =
    entitlementsLoading || withinLimit('max_whatsapp_numbers', 1);
  const isAddingNewNumber = !(selectedConfigId || config?.id);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  const fetchConfig = useCallback(async (acctId: string) => {
    setLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from('whatsapp_config')
        .select(
          'id, user_id, account_id, phone_number_id, waba_id, access_token, verify_token, status, connected_at, registered_at, subscribed_apps_at, last_registration_error, display_name, is_default, created_at, updated_at',
        )
        .eq('account_id', acctId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Failed to load config rows:', error);
      }

      const list = (rows as WhatsAppConfigType[]) || [];
      setConfigs(list);
      const preferred =
        list.find((r) => Number(r.is_default) === 1) || list[0] || null;
      const data =
        (selectedConfigId && list.find((r) => r.id === selectedConfigId)) ||
        preferred;

      if (data) {
        setSelectedConfigId(data.id);
        setConfig(data);
        setDisplayName(data.display_name || '');
        setPhoneNumberId(data.phone_number_id || '');
        setWabaId(data.waba_id || '');
        setAccessToken(MASKED_TOKEN);
        setVerifyToken('');
        setPin('');
        setTokenEdited(false);
        setIsDefault(Boolean(data.is_default));
      } else {
        setSelectedConfigId(null);
        setConfig(null);
        setDisplayName('');
        setPhoneNumberId('');
        setWabaId('');
        setAccessToken('');
        setVerifyToken('');
        setPin('');
        setTokenEdited(false);
        setIsDefault(true);
      }
      setRegistrationProbe(null);

      try {
        const secretRes = await fetch('/api/whatsapp/config/app-secret');
        const secretPayload = await secretRes.json();
        if (secretRes.ok) {
          setWebhookSignatureReady(
            Boolean(secretPayload.configured || secretPayload.server_env_fallback),
          );
        }
      } catch (err) {
        console.error('App secret status check failed:', err);
      }

      if (data) {
        try {
          const res = await fetch(
            `/api/whatsapp/config${data.id ? `?id=${encodeURIComponent(data.id)}` : ''}`,
            { method: 'GET' },
          );
          const payload = await res.json();

          if (payload.connected) {
            setConnectionStatus('connected');
            setResetReason(null);
            setStatusMessage('');
          } else {
            setConnectionStatus('disconnected');
            setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
            setStatusMessage(payload.message || '');
          }
        } catch (err) {
          console.error('Health check failed:', err);
          setConnectionStatus('disconnected');
        }
      } else {
        setConnectionStatus('disconnected');
        setResetReason(null);
        setStatusMessage('');
      }
    } catch (err) {
      console.error('fetchConfig error:', err);
      toast.error('Failed to load WhatsApp configuration');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    // Need both the auth session (`!authLoading`) AND the profile
    // (`!profileLoading`, which carries `accountId`). Without the
    // second guard, the effect would fire with `accountId === null`
    // for the first render window and bail without ever retrying
    // once the profile arrives.
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      setLoading(false);
      return;
    }
    fetchConfig(accountId);
  }, [authLoading, profileLoading, user, accountId, fetchConfig]);

  async function handleSave() {
    setFormError(null);
    if (!phoneNumberId.trim()) {
      setFormError('Phone Number ID is required.');
      toast.error('Phone Number ID is required');
      return;
    }
    if (isAddingNewNumber && !canAddWhatsAppNumber) {
      const msg =
        whatsappLimit != null
          ? whatsappNumberLimitMessage(whatsappLimit)
          : 'WhatsApp number limit reached. Upgrade your plan.';
      setFormError(msg);
      toast.error(msg);
      router.push('/billing');
      return;
    }
    if (!config && (!accessToken.trim() || !tokenEdited)) {
      setFormError('Access Token is required for the first save.');
      toast.error('Access Token is required for initial setup');
      return;
    }

    try {
      setSaving(true);

      const payload: Record<string, unknown> = {
        id: selectedConfigId || config?.id || undefined,
        phone_number_id: phoneNumberId.trim(),
        waba_id: wabaId.trim() || null,
        verify_token: verifyToken.trim() || null,
        display_name: displayName.trim() || null,
        is_default: isDefault,
        pin: pin.trim() || null,
      };

      if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
        payload.access_token = accessToken.trim();
      } else if (config) {
        setFormError('Re-enter the Access Token to save changes.');
        toast.error('Please re-enter the Access Token to save changes');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        const msg = String(data.error || 'Failed to save configuration');
        setFormError(msg);
        toast.error(msg);
        setSaving(false);
        return;
      }

      if (data.registered === false && data.registration_error) {
        const msg = `Saved, but registration failed: ${data.registration_error}`;
        setFormError(msg);
        toast.error(msg, { duration: 10000 });
      } else {
        setFormError(null);
        toast.success(
          data.phone_info?.verified_name
            ? `Connected — ${data.phone_info.verified_name}`
            : 'WhatsApp connected',
        );
        setPin('');
      }

      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Save error:', err);
      setFormError('Failed to save. Check your connection and try again.');
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const id = selectedConfigId || config?.id;
      const res = await fetch(
        `/api/whatsapp/config${id ? `?id=${encodeURIComponent(id)}` : ''}`,
        { method: 'GET' },
      );
      const payload = await res.json();

      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
        toast.success(
          payload.phone_info?.verified_name
            ? `Connected to ${payload.phone_info.verified_name}`
            : 'API connection successful'
        );
      } else {
        setConnectionStatus('disconnected');
        setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
        setStatusMessage(payload.message || '');
        toast.error(payload.message || 'API connection failed');
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error('Connection test failed. Check network and try again.');
    } finally {
      setTesting(false);
    }
  }

  async function handleVerifyRegistration() {
    setVerifyingRegistration(true);
    setRegistrationProbe(null);
    try {
      const id = selectedConfigId || config?.id;
      const res = await fetch(
        `/api/whatsapp/config/verify-registration${
          id ? `?id=${encodeURIComponent(id)}` : ''
        }`,
        { method: 'GET' },
      );
      const data = (await res.json()) as RegistrationProbe;
      setRegistrationProbe(data);
      if (data.live) {
        toast.success('Number is fully wired — Meta is delivering events.');
      } else {
        toast.error(
          'Number is not fully registered. See the checks below for which step failed.',
          { duration: 8000 },
        );
      }
      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('verify-registration failed:', err);
      toast.error('Could not reach the verification endpoint.');
    } finally {
      setVerifyingRegistration(false);
    }
  }

  async function handleReset() {
    if (!confirm('This will delete the current WhatsApp config so you can re-enter it. Continue?')) {
      return;
    }

    try {
      setResetting(true);
      const id = selectedConfigId || config?.id;
      const res = await fetch(
        `/api/whatsapp/config${id ? `?id=${encodeURIComponent(id)}` : ''}`,
        { method: 'DELETE' },
      );
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to reset configuration');
        return;
      }

      toast.success('Configuration cleared. You can now re-enter your credentials.');
      setSelectedConfigId(null);
      setConfig(null);
      setDisplayName('');
      setPhoneNumberId('');
      setWabaId('');
      setAccessToken('');
      setVerifyToken('');
      setTokenEdited(false);
      setConnectionStatus('disconnected');
      setResetReason(null);
      setStatusMessage('');
      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Reset error:', err);
      toast.error('Failed to reset configuration');
    } finally {
      setResetting(false);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied to clipboard');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const showResetBanner = resetReason === 'token_corrupted';
  const statusTone =
    connectionStatus === 'connected' && isRegistered
      ? 'ok'
      : connectionStatus === 'connected' && !isRegistered
        ? 'warn'
        : config
          ? 'err'
          : 'idle';

  const statusTitle =
    statusTone === 'ok'
      ? 'Connected & registered'
      : statusTone === 'warn'
        ? 'Connected — registration needed'
        : statusTone === 'err'
          ? 'Not connected'
          : 'No number configured';

  const statusHint =
    statusTone === 'ok'
      ? 'This number can send and receive WhatsApp messages.'
      : statusTone === 'warn'
        ? lastRegistrationError
          ? `Registration error: ${lastRegistrationError}`
          : 'Enter the 6-digit PIN and save to finish setup.'
        : statusMessage ||
          (config
            ? 'Fix credentials below, then test connection.'
            : 'Add your Meta credentials to connect WhatsApp.');

  function startAddNumber() {
    if (!canAddWhatsAppNumber) {
      const msg =
        whatsappLimit != null
          ? whatsappNumberLimitMessage(whatsappLimit)
          : 'WhatsApp number limit reached. Upgrade your plan.';
      setFormError(msg);
      toast.error(msg);
      router.push('/billing');
      return;
    }
    setFormError(null);
    setSelectedConfigId(null);
    setConfig(null);
    setDisplayName('');
    setPhoneNumberId('');
    setWabaId('');
    setAccessToken('');
    setVerifyToken('');
    setPin('');
    setTokenEdited(false);
    setIsDefault(configs.length === 0);
    setConnectionStatus('unknown');
    setResetReason(null);
    setStatusMessage('');
    setRegistrationProbe(null);
  }

  async function setDefaultNumber(id: string) {
    const res = await fetch('/api/whatsapp/numbers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_default: true }),
    });
    if (!res.ok) {
      toast.error('Failed to set default');
      return;
    }
    toast.success('Default number updated');
    if (accountId) await fetchConfig(accountId);
  }

  async function removeNumber(id: string) {
    if (!window.confirm('Remove this WhatsApp number?')) return;
    const res = await fetch(`/api/whatsapp/config?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error('Failed to remove number');
      return;
    }
    toast.success('Number removed');
    setFormError(null);
    if (accountId) await fetchConfig(accountId);
  }

  return (
    <div className="mt-4 space-y-5">
      {/* Compact status */}
      <div
        className={
          statusTone === 'ok'
            ? 'flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between'
            : statusTone === 'warn'
              ? 'flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between'
              : statusTone === 'err'
                ? 'flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between'
                : 'flex flex-col gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between'
        }
      >
        <div className="flex min-w-0 items-start gap-3">
          {statusTone === 'ok' ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          ) : statusTone === 'warn' ? (
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
          ) : statusTone === 'err' ? (
            <XCircle className="mt-0.5 size-5 shrink-0 text-red-600" />
          ) : (
            <Zap className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{statusTitle}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{statusHint}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestConnection}
            disabled={testing || !config}
          >
            {testing ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
            Test
          </Button>
          {config ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleVerifyRegistration}
              disabled={verifyingRegistration || connectionStatus !== 'connected'}
            >
              {verifyingRegistration ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Verify
            </Button>
          ) : null}
        </div>
      </div>

      {!canEditTeam ? (
        <p className="text-sm text-muted-foreground">
          View only — ask an admin to change WhatsApp credentials.
        </p>
      ) : null}

      {showResetBanner && canEditTeam ? (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <AlertTriangle className="size-4" />
          <AlertTitle>Token can&apos;t be decrypted</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm">
              {statusMessage || 'Reset this number and enter credentials again.'}
            </span>
            <Button
              size="sm"
              onClick={handleReset}
              disabled={resetting}
              className="shrink-0 bg-amber-600 text-white hover:bg-amber-500"
            >
              {resetting ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              Reset number
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!webhookSignatureReady && config ? (
        <Alert className="border-red-200 bg-red-50 text-red-950">
          <AlertTriangle className="size-4" />
          <AlertTitle>App Secret missing</AlertTitle>
          <AlertDescription>
            Webhooks will fail until you add it in{' '}
            <Link href="/whatsapp/app-secret" className="font-medium underline">
              Settings → App Secret
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {formError ? (
        <Alert className="border-red-200 bg-red-50 text-red-950">
          <XCircle className="size-4" />
          <AlertTitle>Couldn&apos;t save</AlertTitle>
          <AlertDescription className="text-sm">{formError}</AlertDescription>
        </Alert>
      ) : null}

      {registrationProbe && !registrationProbe.live ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <AlertTriangle className="size-4" />
          <AlertTitle>Verification failed</AlertTitle>
          <AlertDescription className="space-y-2 text-sm">
            <p>Meta is not delivering events yet. Failed checks:</p>
            <ul className="space-y-1">
              {Object.entries(registrationProbe.checks)
                .filter(([, v]) => v === false)
                .map(([k]) => (
                  <li key={k} className="flex items-center gap-2">
                    <XCircle className="size-3.5 shrink-0 text-red-600" />
                    <code className="text-xs">{k}</code>
                  </li>
                ))}
            </ul>
            {(registrationProbe.errors ?? []).length > 0 ? (
              <ul className="space-y-1 text-red-700">
                {registrationProbe.errors?.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Numbers list + help */}
        <div className="space-y-3">
          <Card className="border-border bg-card ring-0">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">Numbers</CardTitle>
                <CardDescription className="text-xs">
                  {whatsappLimit == null
                    ? `${whatsappUsed} connected · unlimited`
                    : `${whatsappUsed}/${whatsappLimit} used`}
                </CardDescription>
              </div>
              {canEditTeam ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canAddWhatsAppNumber}
                  onClick={startAddNumber}
                >
                  {!canAddWhatsAppNumber ? <Lock className="size-3.5" /> : null}
                  Add
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {!entitlementsLoading && !canAddWhatsAppNumber && whatsappLimit != null ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Limit reached.{' '}
                  <Link href="/billing" className="font-medium underline">
                    Upgrade
                  </Link>
                </div>
              ) : null}

              {configs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  No numbers yet
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {configs.map((row) => {
                    const active = row.id === (selectedConfigId || config?.id);
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setFormError(null);
                            setSelectedConfigId(row.id);
                            setConfig(row);
                            setDisplayName(row.display_name || '');
                            setPhoneNumberId(row.phone_number_id || '');
                            setWabaId(row.waba_id || '');
                            setAccessToken(MASKED_TOKEN);
                            setVerifyToken('');
                            setPin('');
                            setTokenEdited(false);
                            setIsDefault(Boolean(row.is_default));
                            setRegistrationProbe(null);
                          }}
                          className={
                            active
                              ? 'w-full rounded-xl border border-teal-200 bg-teal-50 px-3 py-2.5 text-left'
                              : 'w-full rounded-xl border border-transparent px-3 py-2.5 text-left hover:bg-muted/60'
                          }
                        >
                          <p className="truncate text-sm font-medium text-foreground">
                            {row.display_name || row.phone_number_id}
                            {Boolean(row.is_default) ? (
                              <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
                                Default
                              </span>
                            ) : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {row.phone_number_id}
                          </p>
                        </button>
                        {active && canEditTeam ? (
                          <div className="mt-1.5 flex gap-1.5 px-1">
                            {!Boolean(row.is_default) ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => void setDefaultNumber(row.id)}
                              >
                                Set default
                              </Button>
                            ) : null}
                            {configs.length > 1 ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-destructive"
                                onClick={() => void removeNumber(row.id)}
                              >
                                Remove
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="space-y-2 px-1">
            <Button
              type="button"
              variant="ghost"
              className="h-auto px-0 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground"
              onClick={() => setShowHelp((v) => !v)}
            >
              {showHelp ? 'Hide help' : 'Need help?'}
            </Button>
            {showHelp ? (
              <div className="rounded-xl border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                <ol className="list-decimal space-y-1.5 pl-4">
                  <li>Create a Meta Business app and add WhatsApp.</li>
                  <li>Copy Phone Number ID, WABA ID, and a permanent token.</li>
                  <li>Paste them here, set a verify token + 6-digit PIN, then Save.</li>
                  <li>
                    In Meta webhooks, paste this URL and the same verify token. Subscribe to{' '}
                    <strong className="text-foreground">messages</strong>.
                  </li>
                  <li>
                    Add your{' '}
                    <Link href="/whatsapp/app-secret" className="text-primary underline">
                      App Secret
                    </Link>
                    .
                  </li>
                </ol>
                <a
                  href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="size-3.5" />
                  Meta docs
                </a>
              </div>
            ) : null}
          </div>
        </div>

        {/* Credentials form */}
        <Card className="border-border bg-card ring-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {isAddingNewNumber ? 'Add WhatsApp number' : 'Edit credentials'}
            </CardTitle>
            <CardDescription>
              Paste values from Meta → WhatsApp → API Setup.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Display name</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Sales line"
                  disabled={!canEditTeam}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone Number ID</Label>
                <Input
                  placeholder="From Meta API Setup"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  readOnly={!canEditTeam}
                />
              </div>
              <div className="space-y-1.5">
                <Label>WABA ID</Label>
                <Input
                  placeholder="WhatsApp Business Account ID"
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  readOnly={!canEditTeam}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Access Token</Label>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    placeholder="Permanent token"
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
                    readOnly={!canEditTeam}
                    className="pr-10"
                  />
                  {canEditTeam ? (
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  ) : null}
                </div>
                {config && !tokenEdited ? (
                  <p className="text-xs text-muted-foreground">
                    Hidden for security — paste again to update.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label>Webhook verify token</Label>
                <Input
                  placeholder="Any secret string"
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  readOnly={!canEditTeam}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  2-step PIN{!isRegistered ? <span className="text-red-500"> *</span> : null}
                </Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 digits"
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  readOnly={!canEditTeam}
                  className="tracking-widest"
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={isDefault}
                disabled={!canEditTeam}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              Use as default number
            </label>

            <div className="space-y-1.5">
              <Label>Webhook URL</Label>
              <div className="flex gap-2">
                <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopyWebhookUrl}
                  className="shrink-0"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {canEditTeam ? (
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              ) : null}
              {config && canEditTeam ? (
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={resetting}
                  className="text-destructive hover:text-destructive"
                >
                  {resetting ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                  Reset
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
