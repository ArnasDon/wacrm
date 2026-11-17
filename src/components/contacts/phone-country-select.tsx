'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Globe } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { phoneCountryOptions } from '@/lib/contacts/phone-country';
import { cn } from '@/lib/utils';

const ANY_COUNTRY = 'any';

interface PhoneCountrySelectProps {
  value: string | null;
  onChange: (callingCode: string | null) => void;
  className?: string;
}

export function PhoneCountrySelect({
  value,
  onChange,
  className,
}: PhoneCountrySelectProps) {
  const t = useTranslations('PhoneCountrySelect');
  const locale = useLocale();
  const options = useMemo(() => phoneCountryOptions(locale), [locale]);
  const selected = options.find((option) => option.callingCode === value);

  return (
    <Select
      value={selected ? selected.callingCode : ANY_COUNTRY}
      onValueChange={(next) =>
        onChange(!next || next === ANY_COUNTRY ? null : next)
      }
    >
      <SelectTrigger
        aria-label={t('label')}
        className={cn('border-border text-muted-foreground', className)}
      >
        <Globe className="size-4" />
        <SelectValue>{selected ? selected.label : t('allCountries')}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={ANY_COUNTRY}>{t('allCountries')}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.callingCode} value={option.callingCode}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
