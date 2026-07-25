'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Tag,
  User,
  Palette,
  UsersRound,
  CreditCard,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { TagManager } from '@/components/settings/tag-manager';
import { ProfileForm } from '@/components/settings/profile-form';
import { LeaveTeamCard } from '@/components/settings/leave-team-card';
import { PasswordForm } from '@/components/settings/password-form';
import { TwoFactorForm } from '@/components/settings/two-factor-form';
import { SessionsCard } from '@/components/settings/sessions-card';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { MembersTab } from '@/components/settings/members-tab';
import { BillingSettingsPanel } from '@/components/settings/billing-settings-panel';

const TABS = [
  { value: 'profile', label: 'Profile', icon: User },
  { value: 'tags', label: 'Tags', icon: Tag },
  { value: 'appearance', label: 'Appearance', icon: Palette },
  { value: 'members', label: 'Team', icon: UsersRound },
  { value: 'billing', label: 'Billing', icon: CreditCard },
] as const;

type TabValue = (typeof TABS)[number]['value'];

function isTabValue(v: string | null): v is TabValue {
  return !!v && TABS.some((t) => t.value === v);
}

function SettingsTabButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-muted text-primary'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </button>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const queryTab = searchParams.get('tab');

  // Old Settings tabs moved to dedicated pages under WhatsApp / elsewhere.
  useEffect(() => {
    if (queryTab === 'compliance') {
      router.replace('/compliance');
    } else if (queryTab === 'smtp') {
      router.replace('/email/smtp');
    } else if (queryTab === 'whatsapp') {
      router.replace('/whatsapp/config');
    } else if (queryTab === 'templates') {
      router.replace('/whatsapp/templates');
    } else if (queryTab === 'app-secret') {
      router.replace('/whatsapp/app-secret');
    }
  }, [queryTab, router]);

  const urlTab: TabValue = isTabValue(queryTab) ? queryTab : 'profile';

  // Local state so clicks switch immediately even if the URL sync lags.
  const [tab, setTab] = useState<TabValue>(urlTab);

  useEffect(() => {
    setTab(urlTab);
  }, [urlTab]);

  const onChange = useCallback(
    (next: TabValue) => {
      setTab(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', next);
      router.replace(`/settings?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your profile, team, billing, appearance, and tags. WhatsApp
          connection, templates, and App Secret live under WhatsApp in the
          sidebar.
        </p>
      </div>

      <nav
        aria-label="Settings sections"
        className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
      >
        {TABS.map((item) => (
          <SettingsTabButton
            key={item.value}
            active={tab === item.value}
            label={item.label}
            icon={item.icon}
            onClick={() => onChange(item.value)}
          />
        ))}
      </nav>

      {tab === 'profile' ? (
        <div className="space-y-6">
          <ProfileForm />
          <TwoFactorForm />
          <LeaveTeamCard />
          <PasswordForm />
          <SessionsCard />
        </div>
      ) : null}

      {tab === 'tags' ? <TagManager /> : null}

      {tab === 'appearance' ? <AppearancePanel /> : null}

      {tab === 'members' ? <MembersTab /> : null}

      {tab === 'billing' ? <BillingSettingsPanel /> : null}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">Loading…</p>
          </div>
          <div className="h-10 animate-pulse rounded-lg border border-border bg-card" />
        </div>
      }
    >
      <SettingsPageInner />
    </Suspense>
  );
}
