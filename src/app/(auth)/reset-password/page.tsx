'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ResetPasswordPage() {
  return <Suspense fallback={null}><ResetPasswordForm /></Suspense>;
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token) { setError('This reset link is invalid or expired.'); return; }
    if (password !== confirmation) { setError('Passwords must match.'); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await authClient.resetPassword({ token, newPassword: password });
      if (result.error) setError(result.error.message ?? 'Unable to reset password.');
      else setDone(true);
    } catch { setError('Unable to connect. Please try again.'); }
    finally { setSaving(false); }
  }

  return <div className="flex min-h-screen items-center justify-center px-4">
    <Card className="w-full max-w-md">
      <CardHeader><CardTitle>Reset password</CardTitle></CardHeader>
      <CardContent>
        {done ? <p>Your password has been updated. <Link className="underline" href="/login">Sign in</Link></p> :
          <form onSubmit={submit} className="space-y-4">
            {(!token || params.get('error')) && <p role="alert">This reset link is invalid or expired. Request another from the sign-in page.</p>}
            {error && <p role="alert">{error}</p>}
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} />
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmation} onChange={e => setConfirmation(e.target.value)} />
            <Button type="submit" disabled={saving || !token}>{saving ? 'Saving…' : 'Reset password'}</Button>
          </form>}
      </CardContent>
    </Card>
  </div>;
}
