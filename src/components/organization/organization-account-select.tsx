'use client';

import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { OrganizationAccount } from '@/types';

const ALL_ACCOUNTS = 'all';

/**
 * Consolidated-view account picker for Inbox/Contacts (migration 041 —
 * organizations). Renders nothing for anyone who isn't an organization
 * owner with at least one linked seller account — GET /api/organization
 * itself is owner-gated (403 for anyone else), and this component
 * treats any failure the same as "no organization" by staying hidden,
 * so a non-owner sees no trace of the feature.
 */
export function OrganizationAccountSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (accountId: string | null) => void;
}) {
  const t = useTranslations('Organization.accountSelect');
  const [accounts, setAccounts] = useState<OrganizationAccount[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/organization');
        const data = await res.json();
        if (!cancelled && res.ok && data.organization) {
          setAccounts(data.accounts ?? []);
        }
      } catch {
        // Stay hidden — this is a nice-to-have consolidated view, not
        // something worth surfacing an error toast for.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (accounts.length < 2) return null;

  // Base UI's <Select.Value> (unlike Radix's) doesn't infer its label
  // from the matching <SelectItem>'s children — without an explicit
  // children function it just prints the raw stored value, which here
  // is an account UUID. This formatter is what turns that into the
  // account name.
  const formatSelected = (v: string) => {
    if (v === ALL_ACCOUNTS) return t('allAccounts');
    const acc = accounts.find((a) => a.id === v);
    if (!acc) return v;
    return `${acc.name}${acc.isOwnerAccount ? t('storeSuffix') : ''}`;
  };

  return (
    <Select
      value={value ?? ALL_ACCOUNTS}
      onValueChange={(v) => onChange(v === ALL_ACCOUNTS ? null : v)}
    >
      <SelectTrigger className="w-[180px] gap-1.5" aria-label={t('filterByAccount')}>
        <Building2 className="size-4 text-muted-foreground" />
        <SelectValue>{(v: string) => formatSelected(v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_ACCOUNTS}>{t('allAccounts')}</SelectItem>
        {accounts.map((acc) => (
          <SelectItem key={acc.id} value={acc.id}>
            {acc.name}
            {acc.isOwnerAccount ? t('storeSuffix') : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
