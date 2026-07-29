"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { submitStoreSignup } from "@/lib/auth/store-signup-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, AUTH_INPUT_CLASS, AUTH_BUTTON_CLASS } from "@/components/auth/auth-shell";
import { MessageSquare, CheckCircle, UsersRound } from "lucide-react";

// `useSearchParams` opts the component out of static prerendering
// unless wrapped in Suspense — same pattern as /login.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  // When the user lands here from `/join/<token>` we carry the
  // invite token in the query so it survives the signup → email
  // verification → redirect round-trip. `emailRedirectTo` below
  // points back at /join/<token> so the user lands on the redeem
  // step after verifying instead of being dropped on /dashboard.
  const inviteToken = searchParams.get("invite");

  // The store-name field + org bootstrap only apply to a brand new
  // store OWNER signing up on their own (no invite token). A seller/
  // team-member invite always lands here WITH a token and joins an
  // EXISTING organization via /join/<token> instead — that path is
  // untouched below.
  const isStoreSignup = !inviteToken;

  const [fullName, setFullName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Store-owner path (no invite token): validation + signUp() +
    // organization bootstrap all live in submitStoreSignup() so it's
    // unit-testable without a component-test harness — see that
    // module's own comment.
    if (isStoreSignup) {
      const result = await submitStoreSignup(
        supabase,
        { fullName, storeName, email, password, confirmPassword },
        window.location.origin,
      );

      if (result.status === "error") {
        setError(result.error);
        setLoading(false);
        return;
      }
      if (result.status === "signed-in") {
        router.push("/settings?tab=whatsapp");
        return;
      }
      setSuccess(true);
      setLoading(false);
      return;
    }

    // Invite path (seller/team-member joining an EXISTING
    // organization) — unchanged from before this feature: point
    // Supabase's verification email back at the join page so the
    // user can accept after verifying.
    if (password !== confirmPassword) {
      setError("As senhas não coincidem");
      setLoading(false);
      return;
    }
    if (password.length < 6) {
      setError("A senha deve ter no mínimo 6 caracteres");
      setLoading(false);
      return;
    }

    const emailRedirectTo = `${window.location.origin}/join/${encodeURIComponent(inviteToken!)}`;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <AuthShell
        icon={<CheckCircle className="h-6 w-6" />}
        title="Verifique seu e-mail"
        description={<>Enviamos um link de confirmação para <span className="text-foreground">{email}</span>. Verifique sua caixa de entrada e clique no link para confirmar sua conta.</>}
      >
        <Link href={inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : "/login"}>
          <Button variant="outline" className="h-11 w-full rounded-full border-border text-muted-foreground hover:bg-muted hover:text-foreground">
            Voltar para o login
          </Button>
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      icon={inviteToken ? <UsersRound className="h-6 w-6" /> : <MessageSquare className="h-6 w-6" />}
      title={inviteToken ? "Criar conta e entrar" : "Criar conta"}
      description={
        inviteToken
          ? "Confirme seu e-mail e depois aceite o convite para entrar na sua equipe."
          : "Crie a conta da sua loja e conecte seu WhatsApp em minutos"
      }
      footer={
        <p>
          Já tem uma conta?{" "}
          <Link href={inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : "/login"}>
            Entrar
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSignup} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="fullName" className="text-muted-foreground">
            Nome completo
          </Label>
          <Input
            id="fullName"
            type="text"
            placeholder="João da Silva"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className={AUTH_INPUT_CLASS}
          />
        </div>

        {isStoreSignup && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="storeName" className="text-muted-foreground">
              Nome da loja ou negócio
            </Label>
            <Input
              id="storeName"
              type="text"
              placeholder="Ex: Loja de Veículos Silva"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              required
              className={AUTH_INPUT_CLASS}
            />
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
            placeholder="No mínimo 6 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={AUTH_INPUT_CLASS}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="confirmPassword" className="text-muted-foreground">
            Confirmar senha
          </Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder="Repita sua senha"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className={AUTH_INPUT_CLASS}
          />
        </div>

        {isStoreSignup && (
          <p className="rounded-2xl border border-border bg-muted px-4 py-3 text-xs text-muted-foreground">
            Sua conta é gratuita por enquanto. Assim que a cobrança da
            plataforma entrar no ar, uma mensalidade passará a ser
            exigida para manter o acesso — vamos avisar com
            antecedência antes de cobrar qualquer coisa.
          </p>
        )}

        <Button type="submit" disabled={loading} className={`mt-2 ${AUTH_BUTTON_CLASS}`}>
          {loading ? "Criando conta..." : "Criar conta"}
        </Button>
      </form>
    </AuthShell>
  );
}
