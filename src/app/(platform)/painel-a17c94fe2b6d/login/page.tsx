"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, AUTH_INPUT_CLASS, AUTH_BUTTON_CLASS } from "@/components/auth/auth-shell";
import {
  signInAsPlatformAdmin,
  verifyPlatformAdminOrSignOut,
} from "@/lib/auth/platform-login";

/**
 * /painel-a17c94fe2b6d/login — dedicated entry point for the platform
 * admin panel. Same Supabase Auth user base as the normal CRM
 * /login, just a separate door with its own identity so this never
 * gets confused with a store's own login. No "create account" link
 * here — the only way onto `platform_admins` is a manual SQL insert
 * (see migration 042).
 */
export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Clean up a stale non-admin session silently (e.g. already signed
  // into the normal CRM in another tab, then navigated straight
  // here) — no error banner for a passive check, just sign out and
  // leave the form empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) return;

      const result = await verifyPlatformAdminOrSignOut(supabase);
      if (!cancelled && result.ok) {
        router.replace("/painel-a17c94fe2b6d");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const result = await signInAsPlatformAdmin(supabase, email, password);

    if (!result.ok) {
      setError(result.error ?? "Não foi possível entrar.");
      setLoading(false);
      return;
    }

    router.push("/painel-a17c94fe2b6d");
  };

  return (
    <AuthShell
      icon={<ShieldCheck className="h-6 w-6" />}
      title="Painel da Plataforma"
      description="Acesso restrito à equipe que opera esta plataforma."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
            placeholder="voce@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={AUTH_INPUT_CLASS}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password" className="text-muted-foreground">
            Senha
          </Label>
          <Input
            id="password"
            type="password"
            placeholder="Sua senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={AUTH_INPUT_CLASS}
          />
        </div>

        <Button type="submit" disabled={loading} className={`mt-2 ${AUTH_BUTTON_CLASS}`}>
          {loading ? "Entrando..." : "Entrar"}
        </Button>
      </form>
    </AuthShell>
  );
}
