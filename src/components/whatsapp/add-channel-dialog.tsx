'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  describeApiError,
  type Channel,
  type ChannelApiError,
} from './channel-types';

const DEFAULT_COLOR = '#25D366';

interface Verified {
  display_phone_number: string | null;
  verified_name: string | null;
  waba_name: string | null;
}

type Field = 'waba_id' | 'phone_number_id' | 'access_token' | 'pin' | 'name' | 'color';

/**
 * "Add New Channel": step 1 checks the WABA ID / Phone Number ID /
 * access token with Meta (nothing saved), step 2 names the channel —
 * prefilled with the number's verified WhatsApp name — and creates it.
 */
export function AddChannelDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (channel: Channel) => void;
}) {
  const t = useTranslations('WhatsAppChannels.add');

  const [step, setStep] = useState<1 | 2>(1);
  const [wabaId, setWabaId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [verified, setVerified] = useState<Verified | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<Field | null>(null);

  function reset() {
    setStep(1);
    setWabaId('');
    setPhoneNumberId('');
    setAccessToken('');
    setPin('');
    setName('');
    setColor(DEFAULT_COLOR);
    setVerified(null);
    setError(null);
    setErrorField(null);
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  function showError(body: ChannelApiError | null, fallback: string) {
    setError(describeApiError(body, fallback));
    setErrorField((body?.field as Field | undefined) ?? null);
  }

  async function verify() {
    setError(null);
    setErrorField(null);
    if (!wabaId.trim() || !phoneNumberId.trim() || !accessToken.trim()) {
      setError(t('allRequired'));
      setErrorField(!wabaId.trim() ? 'waba_id' : !phoneNumberId.trim() ? 'phone_number_id' : 'access_token');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/channels/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waba_id: wabaId.trim(),
          phone_number_id: phoneNumberId.trim(),
          access_token: accessToken.trim(),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        showError(body, t('verifyFailed'));
        return;
      }
      setVerified(body as Verified);
      // Default the channel title to the number's WhatsApp display name.
      setName(body.verified_name || body.display_phone_number || '');
      setStep(2);
    } catch {
      setError(t('networkError'));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setError(null);
    setErrorField(null);
    if (!name.trim()) {
      setError(t('titleRequired'));
      setErrorField('name');
      return;
    }
    if (pin && !/^\d{6}$/.test(pin)) {
      setError(t('pinInvalid'));
      setErrorField('pin');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waba_id: wabaId.trim(),
          phone_number_id: phoneNumberId.trim(),
          access_token: accessToken.trim(),
          pin: pin || undefined,
          name: name.trim(),
          color,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // Credential problems belong to step 1 — send the user back there.
        if (body?.field && ['waba_id', 'phone_number_id', 'access_token'].includes(body.field)) {
          setStep(1);
        }
        showError(body, t('createFailed'));
        return;
      }
      const channel = body.channel as Channel;
      if (body.registration_error) {
        toast.warning(t('createdRegistrationFailed', { name: channel.name ?? '' }), {
          description: describeApiError(
            { error: body.registration_error, meta: body.meta },
            body.registration_error,
          ),
        });
      } else {
        toast.success(t('created', { name: channel.name ?? '' }));
      }
      onCreated(channel);
      close();
    } catch {
      setError(t('networkError'));
    } finally {
      setBusy(false);
    }
  }

  const fieldClass = (f: Field) =>
    cn(errorField === f && 'border-destructive focus-visible:ring-destructive/30');

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {step === 1 ? t('step1Hint') : t('step2Hint')}
          </p>
        </DialogHeader>

        {step === 1 ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="ch-waba">{t('wabaId')}</Label>
              <Input
                id="ch-waba"
                inputMode="numeric"
                autoComplete="off"
                placeholder={t('wabaIdPlaceholder')}
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
                className={fieldClass('waba_id')}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-phone">{t('phoneNumberId')}</Label>
              <Input
                id="ch-phone"
                inputMode="numeric"
                autoComplete="off"
                placeholder={t('phoneNumberIdPlaceholder')}
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                className={fieldClass('phone_number_id')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-token">{t('accessToken')}</Label>
              <Input
                id="ch-token"
                type="password"
                autoComplete="off"
                placeholder={t('accessTokenPlaceholder')}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                className={fieldClass('access_token')}
              />
            </div>
            {error ? <ErrorBox message={error} /> : null}
            <DialogFooter className="flex-row justify-between sm:justify-between">
              <Button type="button" variant="outline" onClick={close} disabled={busy}>
                {t('back')}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {busy ? t('verifying') : t('verify')}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            {verified ? (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{t('verifiedTitle')}</p>
                  <p className="truncate text-muted-foreground">
                    {[verified.verified_name, verified.display_phone_number].filter(Boolean).join(' · ')}
                  </p>
                  {verified.waba_name ? (
                    <p className="truncate text-muted-foreground">
                      {t('wabaLabel', { name: verified.waba_name })}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="ch-name">{t('channelTitle')}</Label>
              <Input
                id="ch-name"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={fieldClass('name')}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-color">{t('colorCode')}</Label>
              <div className="flex items-center gap-2">
                <input
                  id="ch-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-8 w-24 cursor-pointer rounded-md border border-border bg-background p-0.5"
                />
                <span className="font-mono text-xs text-muted-foreground">{color.toUpperCase()}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-pin">{t('pin')}</Label>
              <Input
                id="ch-pin"
                inputMode="numeric"
                maxLength={6}
                autoComplete="off"
                placeholder="123456"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                className={fieldClass('pin')}
              />
              <p className="text-xs text-muted-foreground">{t('pinHint')}</p>
            </div>
            {error ? <ErrorBox message={error} /> : null}
            <DialogFooter className="flex-row justify-between sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setError(null);
                  setErrorField(null);
                  setStep(1);
                }}
                disabled={busy}
              >
                {t('back')}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {busy ? t('creating') : t('create')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
      {message}
    </p>
  );
}
