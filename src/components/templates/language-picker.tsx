'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { TEMPLATE_LANGUAGES, templateLanguageName } from '@/lib/whatsapp/template-languages';

/**
 * Compact, searchable language picker for templates. Replaces a native
 * <select>: with 70+ options the browser's own list opens nearly
 * full-screen. This one opens a small panel — search box plus a list
 * that scrolls within ~240px.
 */
export function LanguagePicker({
  value,
  onChange,
  disabled,
  ariaLabel,
  searchPlaceholder,
  noResults,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  searchPlaceholder: string;
  noResults: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const options = useMemo(() => {
    // A code synced from Meta that isn't in the list still shows.
    const list = TEMPLATE_LANGUAGES.some((l) => l.code === value) || !value
      ? TEMPLATE_LANGUAGES
      : [{ code: value, name: value }, ...TEMPLATE_LANGUAGES];
    const q = query.trim().toLowerCase();
    return q
      ? list.filter((l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q))
      : list;
  }, [query, value]);

  function pick(code: string) {
    onChange(code);
    setOpen(false);
    setQuery('');
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        aria-label={ariaLabel}
        className="flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted px-2.5 text-left text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="truncate">
          {templateLanguageName(value)}
          <span className="ml-1.5 text-xs text-muted-foreground">{value}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 gap-1.5 p-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (options[0]) pick(options[0].code);
              }
            }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-8 w-full rounded-md border border-border bg-background pr-2 pl-7 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring"
          />
        </div>
        <ul role="listbox" aria-label={ariaLabel} className="max-h-60 overflow-y-auto">
          {options.length === 0 ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">{noResults}</li>
          ) : (
            options.map((l) => {
              const selected = l.code === value;
              return (
                <li key={l.code} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => pick(l.code)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                      selected && 'bg-primary/10 text-primary',
                    )}
                  >
                    <Check className={cn('size-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
                    <span className="flex-1 truncate">{l.name}</span>
                    <span className="text-xs text-muted-foreground">{l.code}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
