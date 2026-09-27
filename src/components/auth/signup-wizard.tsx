'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  MessageSquare,
  CheckCircle,
  UsersRound,
  ArrowRight,
  Sparkles,
  Plus,
  Settings2,
} from 'lucide-react';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { InviteMemberDialog } from '@/components/settings/invite-member-dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export function SignupWizard({ inviteToken }: { inviteToken: string | null }) {
  const t = useTranslations('SignupPage');
  const { profileLoading } = useAuth();
  const [step, setStep] = useState(1);

  // Step 1 State
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  // Step 4 State
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [invitesSent, setInvitesSent] = useState(0);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t('passwordsMismatch'));
      return;
    }

    if (password.length < 6) {
      setError(t('passwordTooShort'));
      return;
    }

    setLoading(true);

    const emailRedirectTo = inviteToken
      ? `${window.location.origin}/join/${encodeURIComponent(inviteToken)}`
      : undefined;

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      // Email confirmation required
      setStep(99);
    } else {
      setStep(2);
    }
    setLoading(false);
  };

  const renderStepIndicators = () => (
    <div className="mb-8 flex items-center justify-center gap-2">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`h-2 rounded-full transition-all ${
            step === i
              ? 'bg-primary w-8'
              : step > i
                ? 'bg-primary/50 w-2'
                : 'bg-muted w-2'
          }`}
        />
      ))}
    </div>
  );

  if (step === 99) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center px-4">
        <Card className="border-border bg-card w-full max-w-md">
          <CardHeader className="items-center text-center">
            <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
              <CheckCircle className="text-primary h-6 w-6" />
            </div>
            <CardTitle className="text-foreground text-xl">
              {t('checkEmailTitle')}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t.rich('checkEmailDesc', {
                email,
                strong: (chunks) => (
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
                  : '/login'
              }
            >
              <Button
                variant="outline"
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground w-full"
              >
                {t('backToSignIn')}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-4xl">
        {step > 1 && renderStepIndicators()}

        {step === 1 && (
          <div className="mx-auto max-w-md">
            <Card className="border-border bg-card w-full">
              <CardHeader className="items-center text-center">
                <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
                  {inviteToken ? (
                    <UsersRound className="text-primary h-6 w-6" />
                  ) : (
                    <MessageSquare className="text-primary h-6 w-6" />
                  )}
                </div>
                <CardTitle className="text-foreground text-xl">
                  {inviteToken ? t('titleJoin') : t('title')}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  {inviteToken ? t('descJoin') : t('desc')}
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
                      {t('fullNameLabel')}
                    </Label>
                    <Input
                      id="fullName"
                      type="text"
                      placeholder={t('fullNamePlaceholder')}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                      className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="email" className="text-muted-foreground">
                      {t('emailLabel')}
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder={t('emailPlaceholder')}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="password" className="text-muted-foreground">
                      {t('passwordLabel')}
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder={t('passwordPlaceholder')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label
                      htmlFor="confirmPassword"
                      className="text-muted-foreground"
                    >
                      {t('confirmPasswordLabel')}
                    </Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder={t('confirmPasswordPlaceholder')}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={loading || profileLoading}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 h-10 w-full disabled:opacity-50"
                  >
                    {loading || profileLoading ? t('creating') : t('submit')}
                  </Button>
                </form>

                <p className="text-muted-foreground mt-6 text-center text-sm">
                  {t('haveAccount')}{' '}
                  <Link
                    href={
                      inviteToken
                        ? `/login?invite=${encodeURIComponent(inviteToken)}`
                        : '/login'
                    }
                    className="text-primary hover:text-primary/80"
                  >
                    {t('signIn')}
                  </Link>
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Connect WhatsApp
              </h2>
              <p className="text-muted-foreground">
                Link your WhatsApp Business API account to start messaging
                leads.
              </p>
            </div>

            <WhatsAppConfig />

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setStep(3)}>
                Skip for now
              </Button>
              <Button onClick={() => setStep(3)}>
                Continue <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            <div className="text-center">
              <div className="bg-primary/10 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl">
                <Settings2 className="text-primary h-8 w-8" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Choose your Pipeline
              </h2>
              <p className="text-muted-foreground mt-2">
                Select the template that best fits your business. We&apos;ve
                pre-configured stages and automations to get you started.
              </p>
            </div>

            <Card className="border-border bg-card">
              <CardContent className="pt-6">
                <RadioGroup
                  defaultValue="real-estate"
                  className="flex flex-col gap-4"
                >
                  <div className="border-primary/50 bg-primary/5 flex items-start gap-4 rounded-lg border p-4">
                    <RadioGroupItem
                      value="real-estate"
                      id="real-estate"
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <Label
                        htmlFor="real-estate"
                        className="flex items-center gap-2 text-base font-medium"
                      >
                        Real Estate Pipeline
                        <span className="bg-primary/20 text-primary rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">
                          Recommended
                        </span>
                      </Label>
                      <p className="text-muted-foreground mt-1 text-sm">
                        Includes standard real estate stages (New, Contacted,
                        Site Visit, Negotiation, Closed) and pre-built site
                        visit reminders.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4 rounded-lg border p-4 opacity-75">
                    <RadioGroupItem
                      value="general"
                      id="general"
                      className="mt-1"
                      disabled
                    />
                    <div className="flex-1">
                      <Label
                        htmlFor="general"
                        className="text-muted-foreground flex items-center gap-2 text-base font-medium"
                      >
                        General CRM
                        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">
                          Coming Soon
                        </span>
                      </Label>
                      <p className="text-muted-foreground mt-1 text-sm">
                        A basic pipeline for general sales and lead tracking.
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            <div className="flex justify-end pt-4">
              <Button onClick={() => setStep(4)} className="w-full sm:w-auto">
                Continue <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="mx-auto flex max-w-2xl flex-col gap-6 pt-8 text-center">
            <div className="bg-primary/10 mx-auto mb-2 flex h-20 w-20 items-center justify-center rounded-full">
              <Sparkles className="text-primary h-10 w-10" />
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">
                You&apos;re all set!
              </h2>
              <p className="text-muted-foreground mx-auto mt-2 max-w-md">
                Your real estate CRM is ready. Invite your team members now or
                skip this step to do it later.
              </p>
            </div>

            <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
              <Button
                variant="outline"
                size="lg"
                onClick={() => setInviteModalOpen(true)}
                className="gap-2"
              >
                <Plus className="h-5 w-5" />
                Invite Team Members
              </Button>
              <Link href="/dashboard">
                <Button size="lg" className="w-full gap-2 sm:w-auto">
                  Go to Dashboard <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
            </div>

            {invitesSent > 0 && (
              <p className="mt-4 text-sm font-medium text-emerald-500">
                {invitesSent} invitation{invitesSent > 1 ? 's' : ''} created.
              </p>
            )}

            <InviteMemberDialog
              open={inviteModalOpen}
              onOpenChange={setInviteModalOpen}
              onCreated={() => setInvitesSent((prev) => prev + 1)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
