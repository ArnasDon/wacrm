'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppProviderPanel } from '@/components/settings/whatsapp-provider-panel';
import { TemplateManager } from '@/components/settings/template-manager';
import { QuickRepliesManager } from '@/components/settings/quick-replies-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { OrganizationSettings } from '@/components/settings/organization-settings';
import { BillingSettings } from '@/components/settings/billing-settings';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import {
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency, isOwner } = useAuth();
  const { mode } = useTheme();
  const t = useTranslations('Settings');

  // The URL (`?tab=`) is the single source of truth for the active
  // section — deep-linkable, and it keeps the existing links in the
  // app sidebar/header working. Legacy tab values (tags, custom-fields)
  // resolve onto their new home; unknown/empty → the Overview landing.
  const section = resolveSection(searchParams.get('tab'));

  // Approved message templates are a Meta-only concept (Meta's own
  // policy requires them for business-initiated sends outside the 24h
  // window; uazapi has no equivalent pipeline — see provider-types.ts).
  // Hide the section entirely for uazapi accounts rather than letting
  // them navigate into a screen that can create templates nothing can
  // ever send.
  const [templatesHiddenByProvider, setTemplatesHiddenByProvider] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/whatsapp/provider');
        const data = await res.json();
        if (res.ok && data.provider === 'uazapi') {
          setTemplatesHiddenByProvider(true);
        }
      } catch {
        // Fail open — worst case the Templates tab stays visible and
        // a send attempt 400s server-side with a clear message.
      }
    })();
  }, []);

  // Organization is a store-owner-only concept (migration 041) — a
  // non-owner (or a viewer/agent/admin without the 'owner' role) never
  // sees the section at all, same "hide, don't just 403" treatment as
  // Templates for a uazapi account.
  const hiddenSections: SettingsSection[] = useMemo(() => {
    const hidden: SettingsSection[] = [];
    if (templatesHiddenByProvider) hidden.push('templates');
    if (!isOwner) hidden.push('organization', 'billing');
    return hidden;
  }, [templatesHiddenByProvider, isOwner]);

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  // Direct-URL guard: if a hidden section is deep-linked straight to
  // (an old bookmark, a stale link — uazapi + templates, or a non-owner
  // + organization), bounce to Overview rather than rendering a section
  // this account can't act on.
  useEffect(() => {
    if (hiddenSections.includes(section)) {
      go('overview');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, hiddenSections]);

  // Cheap, fetch-free rail hints. The Overview landing carries the
  // full live status/counts; the rail just surfaces the two that are
  // already in context.
  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency],
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} hiddenSections={hiddenSections} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: <WhatsAppProviderPanel />,
    templates: <TemplateManager />,
    'quick-replies': <QuickRepliesManager />,
    fields: <FieldsAndTagsPanel />,
    deals: <DealsSettings />,
    members: <MembersTab />,
    organization: <OrganizationSettings />,
    billing: <BillingSettings />,
    api: <ApiKeysSettings />,
  };

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('pageDesc')}
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail active={section} onSelect={go} hints={hints} hiddenSections={hiddenSections} />
        <div className="min-w-0">{panel[section]}</div>
      </div>
    </div>
  );
}
