'use client';

import { Shield, SlidersHorizontal } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { CustomFieldsPanel } from '@/components/contacts/custom-fields-manager';
import { SettingsChip } from './settings-chip';

/**
 * Settings → Custom Fields card. Manages the account-wide custom
 * contact field catalogue (the same panel the Contacts page exposes
 * via a dialog). Writes are admin-gated by the caller and enforced by
 * `custom_fields` RLS.
 */
export function CustomFieldsSettings() {
  const t = useTranslations('Settings.tagsAndFields');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2">
          <SlidersHorizontal className="text-primary size-4" />
          {t('fieldsTitle')}
          <SettingsChip variant="admin" className="font-medium">
            <Shield />
            {t('adminRole')}
          </SettingsChip>
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('fieldsDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CustomFieldsPanel />
      </CardContent>
    </Card>
  );
}
