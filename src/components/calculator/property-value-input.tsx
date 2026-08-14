'use client';

import { MoneyInput } from './money-input';

interface PropertyValueInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

/** The hero field of the whole module — every other component is
 *  defined relative to this number, so it gets outsized typography
 *  instead of looking like "just another form field" (spec §11). */
export function PropertyValueInput({ label, value, onChange }: PropertyValueInputProps) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <label
        htmlFor="calculadora-valor-imovel"
        className="text-sm font-medium text-muted-foreground"
      >
        {label}
      </label>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold text-muted-foreground select-none">R$</span>
        <MoneyInput
          id="calculadora-valor-imovel"
          value={value}
          onChange={onChange}
          placeholder="0,00"
          className="w-full min-w-0 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
        />
      </div>
    </div>
  );
}
