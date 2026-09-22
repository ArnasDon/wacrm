"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { NOME_DO_APP } from "@/lib/marca";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  const t = useTranslations("SignupPage");
  const searchParams = useSearchParams();
  // When the user lands here from `/join/<token>` we carry the
  // invite token in the query. With it, the account is created by the
  // SERVER (`/api/invitations/<token>/cadastro`), which checks the
  // invitation first — so a new teammate still gets in with the public
  // signup CLOSED in Supabase. Without it, this is the plain public
  // signup, which is refused (`signup_disabled`) once it is closed.
  const inviteToken = searchParams.get("invite");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  // A conta nasce no servidor, já confirmada; aqui só se entra com ela.
  // Devolve `true` quando a sessão existe — quem chama segue para
  // `/join/<token>`, onde a pessoa ACEITA o convite (o passo de
  // confirmação de sempre, com a conta e o papel à vista).
  const cadastrarPorConvite = async (token: string): Promise<boolean> => {
    let res: Response;
    try {
      res = await fetch(
        `/api/invitations/${encodeURIComponent(token)}/cadastro`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome: fullName, email, senha: password }),
        },
      );
    } catch {
      setError(t("signupFailed"));
      setLoading(false);
      return false;
    }

    if (!res.ok) {
      const corpo = (await res.json().catch(() => ({}))) as {
        codigo?: string;
      };
      setError(mensagemDoCadastro(res.status, corpo.codigo));
      setLoading(false);
      return false;
    }

    // A rota grava o e-mail aparado e em minúsculas; entrar com a mesma
    // forma não depende de o Supabase normalizar do lado dele.
    const { error: erroAoEntrar } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (erroAoEntrar) {
      setError(t("signedUpButSignInFailed"));
      setLoading(false);
      return false;
    }
    return true;
  };

  const mensagemDoCadastro = (status: number, codigo?: string): string => {
    if (status === 429) return t("tooManyAttempts");
    switch (codigo) {
      case "convite_invalido":
        return t("inviteInvalid");
      case "email_existe":
        return t("emailExists");
      case "senha_fraca":
        return t("weakPassword");
      case "dados_invalidos":
        return t("invalidData");
      default:
        return t("signupFailed");
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("passwordsDoNotMatch"));
      return;
    }

    if (password.length < 6) {
      setError(t("passwordTooShort"));
      return;
    }

    setLoading(true);

    if (inviteToken) {
      // Navegação completa, pelo mesmo motivo do ramo sem convite, abaixo:
      // o middleware só lê os cookies da sessão numa requisição nova. O
      // botão continua desabilitado enquanto o navegador troca de página.
      if (await cadastrarPorConvite(inviteToken)) {
        window.location.href = `/join/${encodeURIComponent(inviteToken)}`;
      }
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (error) {
      // Cadastro público fechado no Supabase: a mensagem crua é
      // "Signups not allowed for this instance", em inglês e sem dizer
      // o que fazer.
      setError(
        error.code === "signup_disabled" ? t("signupClosed") : error.message,
      );
      setLoading(false);
      return;
    }

    // Whether a verification email exists at all is a PROJECT setting
    // ("Confirm email" in Supabase Auth), not something this page can
    // assume. The two outcomes are told apart by `data.session`:
    //
    //   session !== null  → confirmation is OFF. The user is already
    //                       signed in, right now. Showing them
    //                       "check your email" strands them waiting
    //                       for a message that is never sent — which
    //                       is exactly what happened to the first
    //                       teammate invited to this account
    //                       (2026-08-30: signed up, auto-confirmed
    //                       17ms later, never redeemed the invite).
    //   session === null  → confirmation is ON. The card below is
    //                       accurate; keep showing it.
    //
    // Hard navigation, not router.push: the session cookies were just
    // written by the Supabase client, and the middleware only reads
    // them on a fresh request. A client-side push can reach /join
    // before the middleware sees the new session and get bounced.
    if (data.session) {
      window.location.href = "/dashboard";
      // Deliberately leave `loading` true: the button stays disabled
      // while the browser navigates, so an impatient second click
      // can't fire a duplicate signUp.
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <CheckCircle className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">
              {t("checkEmailTitle")}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t.rich("checkEmailDescription", {
                email,
                highlight: (chunks) => (
                  <span className="text-foreground">{chunks}</span>
                ),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href={
                inviteToken
                  ? `/login?invite=${encodeURIComponent(inviteToken)}`
                  : "/login"
              }
            >
              <Button
                variant="outline"
                className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t("backToSignIn")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            {inviteToken ? (
              <UsersRound className="h-6 w-6 text-primary" />
            ) : (
              <MessageSquare className="h-6 w-6 text-primary" />
            )}
          </div>
          <CardTitle className="text-xl text-foreground">
            {inviteToken ? t("titleInvite") : t("title")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {inviteToken
              ? t("descriptionInvite")
              : t("description", { appName: NOME_DO_APP })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName" className="text-muted-foreground">
                {t("fullNameLabel")}
              </Label>
              <Input
                id="fullName"
                type="text"
                placeholder={t("fullNamePlaceholder")}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="text-muted-foreground">
                {t("emailLabel")}
              </Label>
              <Input
                id="email"
                type="email"
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-muted-foreground">
                {t("passwordLabel")}
              </Label>
              <Input
                id="password"
                type="password"
                placeholder={t("passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword" className="text-muted-foreground">
                {t("confirmPasswordLabel")}
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder={t("confirmPasswordPlaceholder")}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? t("creatingAccount") : t("createAccountButton")}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t("alreadyHaveAccount")}{" "}
            <Link
              href={
                inviteToken
                  ? `/login?invite=${encodeURIComponent(inviteToken)}`
                  : "/login"
              }
              className="text-primary hover:text-primary/80"
            >
              {t("signIn")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
