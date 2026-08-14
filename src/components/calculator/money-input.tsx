'use client';

import { formatBRLNumber, parseMoneyInputDigits } from '@/lib/calculator/money';
import { cn } from '@/lib/utils';

interface MoneyInputProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Cents-mask BRL input — the same "type digits right-to-left" pattern
 * every Brazilian banking app uses, so "300000" becomes "300.000,00"
 * as you type instead of a plain number the user has to eyeball. The
 * engine still only ever sees/produces a plain reais number; this
 * component is purely presentational, isolated to the calculator.
 */
export function MoneyInput({
  id,
  value,
  onChange,
  placeholder = '0,00',
  className,
  disabled,
}: MoneyInputProps) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      disabled={disabled}
      value={value === 0 ? '' : formatBRLNumber(value)}
      placeholder={placeholder}
      onChange={(e) => onChange(parseMoneyInputDigits(e.target.value))}
      className={cn(
        'border-0 bg-transparent p-0 tabular-nums outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed',
        className,
      )}
    />
  );
}
