"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageSquare, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const t = useTranslations("LoginPage");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    const destination = inviteToken
      ? `/join/${encodeURIComponent(inviteToken)}`
      : "/dashboard";
    window.location.href = destination;
  };

  return (
    <div className="flex min-h-screen">
      {/* Left side — Branding */}
      <div className="relative hidden w-1/2 overflow-hidden lg:block">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0f0b2e] via-[#1a1040] to-[#2d1b69]" />
        
        {/* Abstract shapes */}
        <div className="absolute -right-20 -top-20 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-violet-600/30 via-purple-500/20 to-transparent blur-3xl" />
        <div className="absolute -bottom-32 -left-20 h-[400px] w-[400px] rounded-full bg-gradient-to-tr from-blue-600/25 via-indigo-500/20 to-transparent blur-3xl" />
        <div className="absolute right-20 top-1/3 h-[300px] w-[300px] rounded-full bg-gradient-to-br from-violet-400/20 to-transparent blur-2xl" />
        
        {/* Glowing envelope/wave shape */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="relative flex items-center justify-center">
            {/* Outer glow ring */}
            <div className="absolute h-52 w-52 animate-pulse rounded-full bg-violet-500/20 blur-2xl" />
            {/* Envelope icon */}
            <div className="relative flex h-32 w-40 items-center justify-center">
              <svg viewBox="0 0 160 120" fill="none" className="h-full w-full drop-shadow-[0_0_40px_rgba(139,92,246,0.5)]">
                {/* Envelope body */}
                <path
                  d="M10 30 L80 70 L150 30 M10 30 L10 90 L150 90 L150 30"
                  stroke="url(#envGradient)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  className="opacity-90"
                />
                {/* Envelope flap */}
                <path
                  d="M10 30 L80 60 L150 30"
                  stroke="url(#envGradient)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="rgba(139,92,246,0.1)"
                />
                {/* Paper lines inside */}
                <line x1="45" y1="65" x2="115" y2="65" stroke="rgba(139,92,246,0.3)" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="55" y1="75" x2="105" y2="75" stroke="rgba(139,92,246,0.2)" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="60" y1="85" x2="100" y2="85" stroke="rgba(139,92,246,0.15)" strokeWidth="1.5" strokeLinecap="round" />
                {/* Glow particles */}
                <circle cx="30" cy="50" r="2" fill="rgba(167,139,250,0.6)">
                  <animate attributeName="opacity" values="0.3;1;0.3" dur="3s" repeatCount="indefinite" />
                </circle>
                <circle cx="130" cy="45" r="1.5" fill="rgba(167,139,250,0.5)">
                  <animate attributeName="opacity" values="0.5;1;0.5" dur="2.5s" repeatCount="indefinite" />
                </circle>
                <circle cx="80" cy="35" r="1.5" fill="rgba(99,102,241,0.7)">
                  <animate attributeName="opacity" values="0.7;0.2;0.7" dur="4s" repeatCount="indefinite" />
                </circle>
                <defs>
                  <linearGradient id="envGradient" x1="0" y1="0" x2="160" y2="120">
                    <stop offset="0%" stopColor="#a78bfa" />
                    <stop offset="50%" stopColor="#818cf8" />
                    <stop offset="100%" stopColor="#6366f1" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </div>
        </div>

        {/* Logo */}
        <div className="absolute left-8 top-8 z-10 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 backdrop-blur-sm">
            <MessageSquare className="h-5 w-5 text-violet-300" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-white/90">waivy</span>
        </div>

        {/* Bottom text */}
        <div className="absolute bottom-12 left-8 z-10 max-w-sm">
          <p className="text-2xl font-bold leading-tight text-white">
            Atiende más. Vende más. Crece más.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            CRM inteligente para WhatsApp con agente de IA que atiende a tus
            clientes 24/7, solo o con equipo humano.
          </p>
        </div>

        {/* Navigation dots */}
        <div className="absolute bottom-12 right-8 z-10 flex gap-2">
          <div className="h-2 w-6 rounded-full bg-violet-400" />
          <div className="h-2 w-2 rounded-full bg-white/20" />
          <div className="h-2 w-2 rounded-full bg-white/20" />
        </div>
      </div>

      {/* Right side — Login form */}
      <div className="flex w-full items-center justify-center bg-white px-6 lg:w-1/2 dark:bg-zinc-950">
        <div className="w-full max-w-sm">
          {/* Top sign in button (mobile) */}
          <div className="mb-8 flex justify-end lg:hidden">
            <div className="rounded-full bg-zinc-100 px-4 py-1.5 text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              waivy
            </div>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {inviteToken ? t('titleAccept') : 'Bienvenido de nuevo'}
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {inviteToken
              ? t('descAccept')
              : 'Inicia sesión en tu cuenta'}
          </p>

          {/* Error */}
          {error && (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800/20 dark:bg-red-950/50 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} className="mt-8 flex flex-col gap-5">
            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Correo electrónico
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 rounded-lg border-zinc-300 bg-white px-4 text-zinc-900 placeholder:text-zinc-400 focus-visible:border-violet-500 focus-visible:ring-violet-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Contraseña
                </Label>
                <Link
                  href="/forgot-password"
                  className="text-sm text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Ingresa tu contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11 w-full rounded-lg border-zinc-300 bg-white pr-10 text-zinc-900 placeholder:text-zinc-400 focus-visible:border-violet-500 focus-visible:ring-violet-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-2">
              <input
                id="remember"
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500/20 dark:border-zinc-600"
              />
              <Label htmlFor="remember" className="text-sm text-zinc-500 dark:text-zinc-400">
                Recordarme
              </Label>
            </div>

            {/* Login button */}
            <Button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-lg bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
            </Button>
          </form>

          {/* Register link */}
          <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            ¿No tienes cuenta?{" "}
            <Link
              href={
                inviteToken
                  ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                  : "/signup"
              }
              className="font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
            >
              Regístrate
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
