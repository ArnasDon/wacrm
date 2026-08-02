'use client';

import { useCan } from '@/hooks/use-can';

import { useTranslations } from 'next-intl';

import { CustomFieldsSettings } from './custom-fields-settings';
import { SettingsPanelHead } from './settings-panel-head';
import { TagManager } from './tag-manager';

/**
 * "Fields & tags" section — merges the former Tags and Custom Fields
 * tabs. Tags are visible to everyone; the custom-fields catalogue is
 * account-wide config, so the card is admin-gated (mirroring the old
 * hidden-tab behaviour). `custom_fields` RLS rejects non-admin writes
 * regardless.
 */
export function FieldsAndTagsPanel() {
  const t = useTranslations('Settings.tagsAndFields');
  const canEditSettings = useCan('edit-settings');

  return (
    <section className="max-w-3xl animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
      />
      <TagManager />
      {canEditSettings ? <CustomFieldsSettings /> : null}
    </section>
  );
}
