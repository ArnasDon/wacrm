'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  Settings,
  MessageSquare,
  Tag,
  User,
  Palette,
  UsersRound,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { TemplateManager } from '@/components/settings/template-manager';
import { TagManager } from '@/components/settings/tag-manager';
import { ProfileForm } from '@/components/settings/profile-form';
import { PasswordForm } from '@/components/settings/password-form';
import { SessionsCard } from '@/components/settings/sessions-card';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { MembersTab } from '@/components/settings/members-tab';
import { useAuth } from '@/hooks/use-auth';

const BASE_TAB_VALUES = [
  'profile',
  'whatsapp',
  'templates',
  'tags',
  'appearance',
] as const;
const FLAGGED_TAB_VALUES = ['members'] as const;
const TAB_VALUES = [...BASE_TAB_VALUES, ...FLAGGED_TAB_VALUES] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(v: string | null): v is TabValue {
  return !!v && (TAB_VALUES as readonly string[]).includes(v);
}

// Flag key matches what migration 011 introduced. The Members tab
// stays hidden until the user's profile.beta_features array contains
// this string; flip it via Supabase Studio:
//   UPDATE profiles SET beta_features = beta_features || ARRAY['account_sharing']
//   WHERE user_id = '<theirs>';
const ACCOUNT_SHARING_FLAG = 'account_sharing';

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, profileLoading } = useAuth();

  const accountSharingEnabled =
    !profileLoading &&
    !!profile?.beta_features?.includes(ACCOUNT_SHARING_FLAG);

  // The URL is the single source of truth for the active tab — no
  // local state, no sync effect. A previous revision duplicated this
  // into `useState` + a sync effect, which tripped React 19's
  // set-state-in-effect rule and was also redundant.
  const queryTab = searchParams.get('tab');
  const requestedTab: TabValue = isTabValue(queryTab) ? queryTab : 'profile';

  // If a user lands on /settings?tab=members but the flag is off
  // (e.g. their profile was reset, or they followed a stale link),
  // fall back to the profile tab silently rather than rendering an
  // empty TabsContent.
  const tab: TabValue =
    requestedTab === 'members' && !accountSharingEnabled
      ? 'profile'
      : requestedTab;

  const onChange = (next: TabValue) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage your profile, WhatsApp® integration, message templates, and
          tags.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => onChange(v as TabValue)}>
        <TabsList className="bg-slate-900 border border-slate-700">
          <TabsTrigger
            value="profile"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <User className="size-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger
            value="whatsapp"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <Settings className="size-4" />
            WhatsApp Config
          </TabsTrigger>
          <TabsTrigger
            value="templates"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <MessageSquare className="size-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger
            value="tags"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <Tag className="size-4" />
            Tags
          </TabsTrigger>
          <TabsTrigger
            value="appearance"
            className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
          >
            <Palette className="size-4" />
            Appearance
          </TabsTrigger>
          {/* Members tab is feature-flagged. We render the trigger
              only when the flag is enabled, so users without the
              flag see the original 5-tab layout. */}
          {accountSharingEnabled && (
            <TabsTrigger
              value="members"
              className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
            >
              <UsersRound className="size-4" />
              Members
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <ProfileForm />
          <PasswordForm />
          <SessionsCard />
        </TabsContent>

        <TabsContent value="whatsapp">
          <WhatsAppConfig />
        </TabsContent>

        <TabsContent value="templates">
          <TemplateManager />
        </TabsContent>

        <TabsContent value="tags">
          <TagManager />
        </TabsContent>

        <TabsContent value="appearance">
          <AppearancePanel />
        </TabsContent>

        {accountSharingEnabled && (
          <TabsContent value="members">
            <MembersTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
