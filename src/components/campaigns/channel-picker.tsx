'use client';

import { useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  channelQuality,
  channelState,
  type Channel,
  type Quality,
} from '@/components/whatsapp/channel-types';
import { channelDisplayName } from './channel-details';

const QUALITY_DOT: Record<Quality, string> = {
  GREEN: 'bg-emerald-500',
  YELLOW: 'bg-amber-500',
  RED: 'bg-red-500',
  UNKNOWN: 'bg-muted-foreground/40',
};

/**
 * Channel dropdown for the campaign wizards. Single-select (standard
 * campaign) or multi-select with "select all connected" (advanced).
 * Disconnected channels are listed but can't be picked.
 */
export function ChannelPicker({
  channels,
  value,
  onChange,
  multiple = false,
  hint,
  id,
}: {
  channels: Channel[];
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  /** Extra line per option, e.g. "12 approved templates". */
  hint?: (c: Channel) => string | null;
  id?: string;
}) {
  const t = useTranslations('Broadcasts.channelInfo');
  const tc = useTranslations('WhatsAppChannels');
  const [open, setOpen] = useState(false);
  const selected = channels.filter((c) => value.includes(c.id));
  const usable = (c: Channel) => c.status === 'connected';

  const toggle = (c: Channel) => {
    if (!usable(c)) return;
    if (!multiple) {
      onChange([c.id]);
      setOpen(false);
      return;
    }
    onChange(
      value.includes(c.id) ? value.filter((x) => x !== c.id) : [...value, c.id]
    );
  };

  const dot = (c: Channel) => (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
      style={{ backgroundColor: c.color || '#25D366' }}
    >
      {channelDisplayName(c).slice(0, 1).toUpperCase()}
    </span>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        className="border-border bg-background hover:border-primary/50 focus-visible:border-ring focus-visible:ring-ring/40 flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-sm outline-none focus-visible:ring-3"
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {selected.length === 0 ? (
            <span className="text-muted-foreground">
              {multiple ? t('pick') : t('pickOne')}
            </span>
          ) : multiple ? (
            selected.map((c) => (
              <span
                key={c.id}
                className="bg-muted text-foreground inline-flex items-center gap-1.5 rounded-full py-0.5 pr-1 pl-0.5 text-xs font-medium"
              >
                {dot(c)}
                <span className="max-w-40 truncate">
                  {channelDisplayName(c)}
                </span>
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={t('clear')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(value.filter((x) => x !== c.id));
                  }}
                  className="hover:bg-background rounded-full p-0.5"
                >
                  <X className="size-3" />
                </span>
              </span>
            ))
          ) : (
            <span className="flex min-w-0 items-center gap-2">
              {dot(selected[0])}
              <span className="text-foreground truncate font-medium">
                {channelDisplayName(selected[0])}
              </span>
              <span className="text-muted-foreground truncate font-mono text-xs">
                {selected[0].display_phone_number}
              </span>
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform',
            open && 'rotate-180'
          )}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--anchor-width) min-w-72 gap-0 p-1.5"
      >
        <ul className="max-h-80 overflow-y-auto">
          {channels.map((c) => {
            const active = value.includes(c.id);
            const state = channelState(c);
            const quality = channelQuality(c);
            const extra = hint?.(c);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={!usable(c)}
                  onClick={() => toggle(c)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    active ? 'bg-primary/10' : 'hover:bg-muted'
                  )}
                >
                  {multiple ? (
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border'
                      )}
                    >
                      {active ? <Check className="size-3" /> : null}
                    </span>
                  ) : null}
                  {dot(c)}
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate text-sm font-medium">
                      {channelDisplayName(c)}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      <span className="font-mono">
                        {c.display_phone_number ?? c.phone_number_id}
                      </span>
                      {extra ? ` · ${extra}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5 text-[11px]">
                    <span className="text-muted-foreground">
                      {tc(`state.${state}`)}
                    </span>
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          QUALITY_DOT[quality]
                        )}
                      />
                      {tc(`quality.${quality}`)}
                    </span>
                  </span>
                  {!multiple && active ? (
                    <Check className="text-primary size-4 shrink-0" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        {multiple ? (
          <div className="border-border mt-1 flex items-center justify-between border-t px-1.5 pt-1.5">
            <button
              type="button"
              onClick={() => onChange(channels.filter(usable).map((c) => c.id))}
              className="text-primary rounded px-1.5 py-1 text-xs font-medium hover:underline"
            >
              {t('selectAll')}
            </button>
            {value.length > 0 ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-muted-foreground hover:text-foreground rounded px-1.5 py-1 text-xs"
              >
                {t('clear')}
              </button>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
