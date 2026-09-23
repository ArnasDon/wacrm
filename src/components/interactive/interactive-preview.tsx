'use client';

import { List, Reply } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

/**
 * WhatsApp-style read-only render of an interactive message. Used both
 * in the builder's live preview and by the inbox message bubble so a
 * sent buttons/list message shows the same way it does on the phone.
 *
 * Purely presentational — the buttons/rows are not clickable here (the
 * customer taps them on their own device). Kept namespace-free so it can
 * be dropped into the composer, the automation builder, and the
 * quick-replies manager without namespace coupling: the three fallback
 * labels shown for empty fields default to plain English, and a host
 * that has a translator can pass its own via `labels`.
 */
export interface InteractivePreviewLabels {
  /** Shown in place of an empty body. */
  body?: string;
  /** Shown in place of an untitled reply button. */
  button?: string;
  /** Shown in place of an empty list button label. */
  menu?: string;
}

export function InteractivePreview({
  payload,
  className,
  labels,
}: {
  payload: InteractiveMessagePayload;
  className?: string;
  labels?: InteractivePreviewLabels;
}) {
  const bodyLabel = labels?.body ?? 'Message body…';
  const buttonLabel = labels?.button ?? 'Button';
  const menuLabel = labels?.menu ?? 'Menu';
  return (
    <div
      className={cn(
        'bg-card text-foreground ring-border w-full max-w-[260px] overflow-hidden rounded-lg shadow-sm ring-1',
        className
      )}
    >
      <div className="px-3 py-2">
        {payload.header ? (
          <p className="mb-1 text-sm font-semibold break-words">
            {payload.header}
          </p>
        ) : null}
        <p className="text-sm break-words whitespace-pre-wrap">
          {payload.body || (
            <span className="text-muted-foreground">{bodyLabel}</span>
          )}
        </p>
        {payload.footer ? (
          <p className="text-muted-foreground mt-1 text-[11px] break-words">
            {payload.footer}
          </p>
        ) : null}
      </div>

      {payload.kind === 'buttons' ? (
        <div className="border-border flex flex-col border-t">
          {payload.buttons.map((b, i) => (
            <button
              key={b.id || i}
              type="button"
              disabled
              className="border-border text-primary flex items-center justify-center gap-1.5 border-t py-2 text-sm font-medium first:border-t-0"
            >
              <Reply className="h-3.5 w-3.5" />
              <span className="truncate">{b.title || buttonLabel}</span>
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          disabled
          className="border-border text-primary flex w-full items-center justify-center gap-1.5 border-t py-2 text-sm font-medium"
        >
          <List className="h-3.5 w-3.5" />
          <span className="truncate">{payload.button_label || menuLabel}</span>
        </button>
      )}
    </div>
  );
}
