'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

export function TwoFactorForm() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/two-factor', {
          credentials: 'include',
        });
        const payload = await res.json();
        if (!cancelled && res.ok) {
          setEnabled(Boolean(payload.data?.twoFactorEnabled));
        }
      } catch (err) {
        console.error('[TwoFactorForm] load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggle = async (next: boolean) => {
    setSaving(true);
    const previous = enabled;
    setEnabled(next);
    try {
      const res = await fetch('/api/auth/two-factor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled: next }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setEnabled(previous);
        toast.error(payload.error?.message || 'Could not update 2FA');
        return;
      }
      toast.success(
        next
          ? 'Two-factor authentication enabled — you will need an email code on each sign-in'
          : 'Two-factor authentication disabled',
      );
    } catch (err) {
      setEnabled(previous);
      const msg = err instanceof Error ? err.message : 'Could not update 2FA';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-muted/40 border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <ShieldCheck className="size-5" />
          Two-factor authentication
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          When enabled, signing in requires your password plus a one-time code
          sent to your email.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card/60 px-4 py-3">
          <div className="space-y-1">
            <Label htmlFor="two-factor-toggle" className="text-foreground">
              Require email OTP at login
            </Label>
            <p className="text-xs text-muted-foreground">
              After email and password, we send a 6-digit code to verify it is
              you.
            </p>
          </div>
          {loading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              id="two-factor-toggle"
              checked={enabled}
              onCheckedChange={onToggle}
              disabled={saving}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
