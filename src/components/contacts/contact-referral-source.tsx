'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { ExternalLink, Megaphone } from 'lucide-react';
import {
  parseReferral,
  safeReferralUrl,
} from '@/lib/contacts/referral-source';

interface ContactReferralSourceProps {
  referralSource: unknown;
  receivedAt?: string | null;
}

export function ContactReferralSourceLine({
  referralSource,
  receivedAt,
}: ContactReferralSourceProps) {
  const t = useTranslations('Contacts.detailView.referral');
  const format = useFormatter();
  const referral = parseReferral(referralSource);
  if (!referral) return null;

  const sourceLabel =
    referral.source_type === 'ad'
      ? t('ad')
      : referral.source_type === 'post'
        ? t('post')
        : t('other');
  const sourceUrl = safeReferralUrl(referral.source_url);
  const receivedDate = receivedAt ? new Date(receivedAt) : null;
  const parts = [
    referral.headline,
    receivedDate && !Number.isNaN(receivedDate.getTime())
      ? format.dateTime(receivedDate, { dateStyle: 'medium' })
      : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <p className="mt-1.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <Megaphone className="size-3 shrink-0" />
      <span className="shrink-0">{t('cameFrom')}</span>
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex shrink-0 items-center gap-0.5 font-medium text-foreground hover:text-primary"
        >
          {sourceLabel}
          <ExternalLink className="size-3" />
        </a>
      ) : (
        <span className="shrink-0 font-medium text-foreground">{sourceLabel}</span>
      )}
      {parts.length > 0 && (
        <span className="truncate" title={parts.join(' · ')}>
          · {parts.join(' · ')}
        </span>
      )}
    </p>
  );
}
