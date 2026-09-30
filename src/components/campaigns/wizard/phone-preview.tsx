'use client';

import {
  ChevronLeft,
  MoreVertical,
  Mic,
  Paperclip,
  Phone,
  Smile,
  Video,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  TemplatePreview,
  fillVariables,
} from '@/components/templates/template-preview';
import {
  templateSlots,
  type TemplateMapping,
  type ValueSource,
} from '@/lib/campaigns/advanced';
import type { MessageTemplate, TemplateButton } from '@/types';

/**
 * A template shown inside a phone mock-up — the chat the recipient sees,
 * from the sending number.
 */
export function PhonePreview({
  channelName,
  channelPhone,
  headerType,
  headerText,
  mediaUrl,
  body,
  footer,
  buttons,
  className,
}: {
  channelName: string;
  channelPhone?: string | null;
  headerType?: string | null;
  headerText?: string | null;
  mediaUrl?: string | null;
  body: string;
  footer?: string | null;
  buttons?: TemplateButton[] | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full max-w-[17rem] overflow-hidden rounded-[2.4rem] border-[9px] border-neutral-900 bg-neutral-900 shadow-xl sm:max-w-[20rem]',
        className
      )}
    >
      {/* Status bar + notch */}
      <div className="relative flex h-7 items-center justify-between bg-[#008069] px-5 font-mono text-[10px] text-white">
        <span>10:30</span>
        <span className="absolute top-1 left-1/2 h-4 w-20 -translate-x-1/2 rounded-full bg-neutral-900" />
        <span className="tracking-tighter">▮▮▮ ▭</span>
      </div>
      {/* Chat header */}
      <div className="flex items-center gap-2 bg-[#008069] px-2 pb-2 text-white">
        <ChevronLeft className="size-4 shrink-0" />
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/25 text-xs font-semibold">
          {channelName.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold">
            {channelName}
          </span>
          {channelPhone ? (
            <span className="block truncate text-[10px] opacity-80">
              {channelPhone}
            </span>
          ) : null}
        </span>
        <Video className="size-4 shrink-0" />
        <Phone className="size-4 shrink-0" />
        <MoreVertical className="size-4 shrink-0" />
      </div>
      {/* Chat */}
      <div className="min-h-[18rem] space-y-2 bg-[#efeae2] px-3 py-3 sm:min-h-[22rem] dark:bg-[#0b141a]">
        <p className="mx-auto w-fit rounded-md bg-white px-2 py-0.5 text-[10px] text-neutral-600 shadow-sm dark:bg-[#1f2c34] dark:text-neutral-300">
          Today
        </p>
        <p className="mx-auto max-w-[90%] rounded-md bg-[#fff5c4] px-2 py-1 text-center text-[9px] leading-snug text-neutral-600 dark:bg-[#1f2c34] dark:text-neutral-300">
          Messages are end-to-end encrypted. No one outside this chat can read
          them.
        </p>
        <TemplatePreview
          className="bg-transparent p-0 dark:bg-transparent"
          headerType={headerType}
          headerText={headerText}
          mediaUrl={mediaUrl}
          body={body}
          footer={footer}
          buttons={buttons}
        />
      </div>
      {/* Composer */}
      <div className="flex items-center gap-2 bg-[#efeae2] px-2 pb-3 dark:bg-[#0b141a]">
        <span className="flex h-8 flex-1 items-center gap-2 rounded-full bg-white px-3 text-xs text-neutral-400 dark:bg-[#1f2c34]">
          <Smile className="size-4" />
          Message
          <Paperclip className="ml-auto size-4" />
        </span>
        <span className="flex size-8 items-center justify-center rounded-full bg-[#00a884] text-white">
          <Mic className="size-4" />
        </span>
      </div>
    </div>
  );
}

/** Stand-in values for the preview when there's no uploaded row. */
const SAMPLE: Record<string, string> = {
  name: 'Aarav',
  phone: '+91 98123 45678',
  email: 'aarav@example.com',
  company: 'Acme Retail',
};

/**
 * PhonePreview props for one template sent from one channel, with the
 * campaign's variable mapping applied to a sample row (the first
 * uploaded row, or stand-in contact values).
 */
export function previewPropsFor(args: {
  channelName: string;
  channelPhone?: string | null;
  template: MessageTemplate;
  mapping: TemplateMapping;
  media: Record<string, string>;
  sampleRow: Record<string, string> | null;
}): Parameters<typeof PhonePreview>[0] {
  const { template, mapping, media, sampleRow } = args;
  const read = (s?: ValueSource) => {
    if (!s) return undefined;
    if (s.type === 'static') return s.value || undefined;
    if (sampleRow) return sampleRow[s.value];
    return s.value.startsWith('cf:') ? 'Sample' : SAMPLE[s.value];
  };
  const slots = templateSlots(template);
  const bodyValues = Array.from(
    { length: Math.max(0, ...slots.body) },
    (_, i) => read(mapping.body?.[String(i + 1)])
  );
  return {
    channelName: args.channelName,
    channelPhone: args.channelPhone,
    headerType: template.header_type,
    headerText:
      template.header_type === 'text'
        ? fillVariables(template.header_content ?? '', [
            read(mapping.header_text),
          ])
        : null,
    mediaUrl:
      (slots.headerMedia && media[slots.headerMedia]) ||
      template.header_media_url,
    body: fillVariables(template.body_text, bodyValues),
    footer: template.footer_text,
    buttons: template.buttons,
  };
}
