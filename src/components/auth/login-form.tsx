'use client';

import { useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell, AUTH_INPUT_CLASS, AUTH_BUTTON_CLASS } from './auth-shell';

/**
 * Shared login form behind /login, /loginempresa and /loginvendedor.
 *
 * All three are the SAME authentication mechanism — Supabase doesn't
 * distinguish "company" from "vendedor" logins, each seller is just
 * its own independent account (migration 041) with its own email +
 * password. The three routes exist purely so each audience gets a
 * link that matches how they think of themselves; nothing here
 * checks or enforces which "kind" of account signs in through which
 * URL — see the /loginempresa and /loginvendedor pages' own comments
 * for why that's deliberate.
 */
export function LoginForm({
  icon,
  title,
  description,
  footer,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
}) {
  const searchParams = useSearchParams();
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
  const inviteToken = searchParams.get('invite');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (inviteToken) {
      router.push(`/join/${encodeURIComponent(inviteToken)}`);
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <AuthShell icon={icon} title={title} description={description} footer={footer}>
      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="email" className="text-muted-foreground">
            E-mail
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="voce@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={AUTH_INPUT_CLASS}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-muted-foreground">
              Senha
            </Label>
            <Link href="/forgot-password" className="text-sm text-primary underline-offset-2 hover:underline">
              Esqueceu a senha?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={AUTH_INPUT_CLASS}
          />
        </div>

        <Button type="submit" disabled={loading} className={`mt-2 ${AUTH_BUTTON_CLASS}`}>
          {loading ? 'Entrando...' : 'Entrar'}
        </Button>
      </form>
    </AuthShell>
  );
}
