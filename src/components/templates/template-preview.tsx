'use client';

import type { ReactNode } from 'react';
import { ExternalLink, FileText, Phone, PlayCircle, Reply } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { TemplateButton } from '@/types';

/** Replace {{n}} with the n-th value; unfilled variables stay visible. */
export function fillVariables(text: string, values: (string | undefined)[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (m, n) => values[Number(n) - 1]?.trim() || m);
}

/**
 * WhatsApp-style chat bubble showing a template as the customer will see
 * it: media or text header, body with variables filled, footer, buttons.
 */
export function TemplatePreview({
  headerType,
  headerText,
  mediaUrl,
  body,
  footer,
  buttons,
  mediaLabel,
  className,
}: {
  headerType?: string | null;
  /** Header text with its variable already filled. */
  headerText?: string | null;
  mediaUrl?: string | null;
  /** Body with variables already filled. */
  body: string;
  footer?: string | null;
  buttons?: TemplateButton[] | null;
  /**
   * Shown in an empty media slot when the header has no media yet. Omit
   * it to leave the slot out until a file is chosen.
   */
  mediaLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl bg-[#e5ddd5] p-3 dark:bg-[#0b141a]', className)}>
      <div className="max-w-[92%] overflow-hidden rounded-lg rounded-tl-none bg-white text-sm text-neutral-900 shadow-sm dark:bg-[#1f2c34] dark:text-neutral-100">
        {headerType === 'image' ? (
          mediaUrl ? (
            // Whole image, never cropped — so it matches what was uploaded.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl} alt="" className="block h-auto max-h-48 w-full bg-black/5 object-contain" />
          ) : mediaLabel ? (
            <MediaSlot label={mediaLabel} />
          ) : null
        ) : null}
        {headerType === 'video' ? (
          mediaUrl ? (
            <video src={mediaUrl} className="block max-h-48 w-full bg-black object-contain" controls muted />
          ) : mediaLabel ? (
            <MediaSlot label={mediaLabel} icon={<PlayCircle className="size-6" />} />
          ) : null
        ) : null}
        {headerType === 'document' && (mediaUrl || mediaLabel) ? (
          <div className="flex items-center gap-2 border-b border-black/5 bg-black/5 px-3 py-3 text-xs dark:border-white/10 dark:bg-white/5">
            <FileText className="size-5 shrink-0 text-red-500" />
            <span className="truncate">
              {mediaUrl ? decodeURIComponent(mediaUrl.split('/').pop() ?? '') : mediaLabel}
            </span>
          </div>
        ) : null}

        <div className="space-y-1 p-2.5">
          {headerType === 'text' && headerText ? <p className="font-semibold">{headerText}</p> : null}
          <p className="whitespace-pre-wrap break-words">{body || '…'}</p>
          {footer ? <p className="text-xs text-neutral-500">{footer}</p> : null}
        </div>

        {buttons && buttons.length > 0 ? (
          <div className="divide-y divide-black/5 border-t border-black/5 dark:divide-white/10 dark:border-white/10">
            {buttons.map((b, i) => (
              <div
                key={i}
                className="flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium text-sky-600 dark:text-sky-400"
              >
                {b.type === 'URL' ? (
                  <ExternalLink className="size-3.5" />
                ) : b.type === 'PHONE_NUMBER' ? (
                  <Phone className="size-3.5" />
                ) : (
                  <Reply className="size-3.5" />
                )}
                {b.text || '…'}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MediaSlot({ label, icon }: { label?: string; icon?: ReactNode }) {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-1 bg-black/5 text-xs text-neutral-500 dark:bg-white/5">
      {icon}
      {label}
    </div>
  );
}
