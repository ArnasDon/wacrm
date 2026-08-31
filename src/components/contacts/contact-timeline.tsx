'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  IconMessage,
  IconNote,
  IconNotebook,
  IconFileDollar,
  IconTargetArrow,
  IconTrophy,
  IconLoader2,
  type Icon,
} from '@tabler/icons-react';

import { createClient } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/currency';
import { cn } from '@/lib/utils';

/**
 * Unified activity feed for one contact — WhatsApp messages, notes,
 * quotes and deal milestones merged into one chronological list
 * (Twenty-style record timeline). Read-only; every source is scoped
 * to the account by its own RLS. No new tables.
 */

type Kind =
  | 'msg_in'
  | 'msg_out'
  | 'internal_note'
  | 'note'
  | 'quote'
  | 'deal_created'
  | 'deal_won';

interface TimelineItem {
  id: string;
  kind: Kind;
  at: string;
  title: string;
  body?: string;
  meta?: string;
}

const ICONS: Record<Kind, Icon> = {
  msg_in: IconMessage,
  msg_out: IconMessage,
  internal_note: IconNotebook,
  note: IconNote,
  quote: IconFileDollar,
  deal_created: IconTargetArrow,
  deal_won: IconTrophy,
};

const ACCENT: Record<Kind, string> = {
  msg_in: 'text-sky-600 dark:text-sky-400',
  msg_out: 'text-blue-600 dark:text-blue-400',
  internal_note: 'text-muted-foreground',
  note: 'text-amber-600 dark:text-amber-400',
  quote: 'text-violet-600 dark:text-violet-400',
  deal_created: 'text-muted-foreground',
  deal_won: 'text-emerald-600 dark:text-emerald-400',
};

const MEDIA_LABEL: Record<string, string> = {
  image: '[imagen]',
  document: '[documento]',
  audio: '[nota de voz]',
  video: '[video]',
  location: '[ubicación]',
  template: '[plantilla]',
};

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function ContactTimeline({
  contactId,
  open,
}: {
  contactId: string | null;
  open: boolean;
}) {
  const t = useTranslations('Contacts.detailView.activity');
  const supabase = createClient();
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Day boundaries captured at load time — computing them in render
  // would be an impure call (Date.now / new Date).
  const [bounds, setBounds] = useState<{ today: string; yesterday: string }>({
    today: '',
    yesterday: '',
  });

  const load = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    const now = new Date();
    setBounds({
      today: now.toISOString().slice(0, 10),
      yesterday: new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10),
    });

    const { data: convs } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId);
    const convIds = ((convs ?? []) as { id: string }[]).map((c) => c.id);

    const [notesRes, quotesRes, dealsRes, msgsRes] = await Promise.all([
      supabase
        .from('contact_notes')
        .select('id, note_text, created_at')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from('quotes')
        .select('id, total, currency, status, created_at')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from('deals')
        .select('id, title, created_at, won_at')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(40),
      convIds.length
        ? supabase
            .from('messages')
            .select('id, sender_type, content_type, content_text, created_at')
            .in('conversation_id', convIds)
            .order('created_at', { ascending: false })
            .limit(60)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);

    const merged: TimelineItem[] = [];

    for (const n of (notesRes.data ?? []) as Record<string, unknown>[]) {
      merged.push({
        id: `note-${n.id}`,
        kind: 'note',
        at: n.created_at as string,
        title: t('note'),
        body: (n.note_text as string) ?? '',
      });
    }

    for (const q of (quotesRes.data ?? []) as Record<string, unknown>[]) {
      merged.push({
        id: `quote-${q.id}`,
        kind: 'quote',
        at: q.created_at as string,
        title: t('quote', { status: t(`quoteStatus.${q.status as string}`) }),
        meta: formatCurrency(
          typeof q.total === 'number' ? q.total : Number(q.total ?? 0),
          (q.currency as string) || 'USD',
        ),
      });
    }

    for (const d of (dealsRes.data ?? []) as Record<string, unknown>[]) {
      merged.push({
        id: `deal-c-${d.id}`,
        kind: 'deal_created',
        at: d.created_at as string,
        title: t('dealCreated'),
        body: (d.title as string) ?? '',
      });
      if (d.won_at) {
        merged.push({
          id: `deal-w-${d.id}`,
          kind: 'deal_won',
          at: d.won_at as string,
          title: t('dealWon'),
          body: (d.title as string) ?? '',
        });
      }
    }

    for (const m of (msgsRes.data ?? []) as Record<string, unknown>[]) {
      const type = (m.content_type as string) ?? 'text';
      const hasText =
        typeof m.content_text === 'string' && m.content_text.trim().length > 0;

      // Internal notes (migration 083) are team-only jottings on the
      // thread, not customer messages — give them their own row.
      if (type === 'internal_note') {
        merged.push({
          id: `msg-${m.id}`,
          kind: 'internal_note',
          at: m.created_at as string,
          title: t('internalNote'),
          body: hasText ? (m.content_text as string) : undefined,
        });
        continue;
      }

      const inbound = m.sender_type === 'customer';
      const text =
        type === 'text' && hasText
          ? (m.content_text as string)
          : (MEDIA_LABEL[type] ?? `[${type}]`);
      merged.push({
        id: `msg-${m.id}`,
        kind: inbound ? 'msg_in' : 'msg_out',
        at: m.created_at as string,
        title: inbound ? t('msgIn') : t('msgOut'),
        body: text,
      });
    }

    merged.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    setItems(merged);
    setLoading(false);
  }, [contactId, supabase, t]);

  useEffect(() => {
    // Fetch-on-open. `load` flips a loading flag synchronously before
    // its first await — the established pattern in this codebase for
    // this rule (see notifications/pipelines pages).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open && contactId) load();
  }, [open, contactId, load]);

  const groups = useMemo(() => {
    const out: { day: string; items: TimelineItem[] }[] = [];
    for (const item of items) {
      const day = dayKey(item.at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
  }, [items]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <IconLoader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">{t('empty')}</p>
    );
  }

  return (
    <div className="space-y-3 py-1">
      {groups.map((group) => {
        const label =
          group.day === bounds.today
            ? t('today')
            : group.day === bounds.yesterday
              ? t('yesterday')
              : new Date(`${group.day}T00:00:00`).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                });
        return (
          <section key={group.day}>
            <p className="text-muted-foreground mb-1 px-1 text-xs font-medium">
              {label}
            </p>
            <ol className="space-y-0.5">
              {group.items.map((item) => {
                const Ico = ICONS[item.kind];
                const time = new Date(item.at).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                return (
                  <li
                    key={item.id}
                    className="hover:bg-muted/50 flex gap-2.5 rounded-md px-1 py-1.5"
                  >
                    <Ico className={cn('mt-0.5 size-4 shrink-0', ACCENT[item.kind])} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-foreground text-sm font-medium">
                          {item.title}
                          {item.meta ? (
                            <span className="text-muted-foreground ml-1.5 font-normal">
                              · {item.meta}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          {time}
                        </span>
                      </div>
                      {item.body ? (
                        <p className="text-muted-foreground mt-0.5 line-clamp-3 text-sm break-words whitespace-pre-wrap">
                          {item.body}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
