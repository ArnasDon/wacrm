'use client';

/**
 * Channel preview for the flow editor.
 *
 * Shows how each message the bot sends will actually look on WhatsApp
 * (clean body + native reply buttons / list) versus Instagram &
 * Facebook Messenger (numbered list appended to the body + quick-reply
 * chips). One editable flow underneath — this view is read-only and
 * purely presentational.
 *
 * The per-channel rendering is delegated to
 * `@/lib/flows/channel-render` (`renderMenuForChannel`), the same
 * module the real sender (`meta-send.ts`) uses, so the mock and the
 * wire can't drift.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { deriveCanvasEdges } from '@/lib/flows/edges';
import {
  renderMenuForChannel,
  type FlowChannel,
} from '@/lib/flows/channel-render';
import { useFlowEditor } from './flow-editor-state';
import type { BuilderNode } from './shared';

/** Nodes that put a message in front of the customer. */
const MESSAGE_NODE_TYPES = new Set([
  'send_message',
  'send_buttons',
  'send_list',
  'send_media',
]);

/** Message-bearing nodes in the order the runner would reach them,
 *  walking edges from the entry node. Falls back to array order when
 *  there's no usable entry. */
function orderedMessageNodes(
  nodes: BuilderNode[],
  entry: string | null,
): BuilderNode[] {
  const byKey = new Map(nodes.map((n) => [n.node_key, n]));
  if (!entry || !byKey.has(entry)) {
    return nodes.filter((n) => MESSAGE_NODE_TYPES.has(n.node_type));
  }
  const adj = new Map<string, string[]>();
  for (const e of deriveCanvasEdges(nodes)) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const seen = new Set<string>();
  const queue = [entry];
  const out: BuilderNode[] = [];
  while (queue.length) {
    const key = queue.shift()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = byKey.get(key);
    if (!node) continue;
    if (MESSAGE_NODE_TYPES.has(node.node_type)) out.push(node);
    for (const next of adj.get(key) ?? []) queue.push(next);
  }
  // Anything unreachable still gets shown, after the reachable set.
  for (const n of nodes) {
    if (!seen.has(n.node_key) && MESSAGE_NODE_TYPES.has(n.node_type)) {
      out.push(n);
    }
  }
  return out;
}

export function FlowChannelPreview() {
  const t = useTranslations('Flows.builder');
  const { state } = useFlowEditor();
  const [channel, setChannel] = useState<FlowChannel>('whatsapp');

  const messageNodes = useMemo(
    () => orderedMessageNodes(state.nodes, state.entry_node_id),
    [state.nodes, state.entry_node_id],
  );

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
      {/* channel toggle */}
      <div
        role="group"
        aria-label={t('previewChannelLabel')}
        className="border-border bg-muted mx-auto inline-flex gap-0.5 rounded-lg border p-0.5"
      >
        <ChannelButton
          active={channel === 'whatsapp'}
          onClick={() => setChannel('whatsapp')}
          label={t('previewChannelWhatsApp')}
        />
        <ChannelButton
          active={channel === 'meta'}
          onClick={() => setChannel('meta')}
          label={t('previewChannelMeta')}
        />
      </div>

      <p className="text-muted-foreground text-center text-xs">
        {channel === 'whatsapp'
          ? t('previewWhatsAppHint')
          : t('previewMetaHint')}
      </p>

      {/* chat surface */}
      <div
        className={cn(
          'flex flex-col gap-2.5 rounded-2xl border p-3.5',
          channel === 'whatsapp'
            ? 'border-emerald-600/20 bg-emerald-50/40 dark:bg-emerald-950/10'
            : 'border-blue-600/20 bg-blue-50/40 dark:bg-blue-950/10',
        )}
      >
        {messageNodes.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-xs">
            {t('previewEmpty')}
          </p>
        )}
        {messageNodes.map((node) => (
          <BotBubble key={node.node_key} node={node} channel={channel} t={t} />
        ))}
      </div>
    </div>
  );
}

function ChannelButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors',
        active
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function BotBubble({
  node,
  channel,
  t,
}: {
  node: BuilderNode;
  channel: FlowChannel;
  t: ReturnType<typeof useTranslations>;
}) {
  const isWhatsApp = channel === 'whatsapp';
  const bubbleTone = isWhatsApp
    ? 'bg-emerald-100 dark:bg-emerald-900/40'
    : 'bg-white dark:bg-zinc-800';

  if (node.node_type === 'send_message') {
    const text = (node.config as { text?: string }).text || t('previewNoText');
    return (
      <div className={cn('max-w-[85%] rounded-xl px-3 py-2', bubbleTone)}>
        <p className="text-foreground text-[13px] whitespace-pre-wrap">{text}</p>
      </div>
    );
  }

  if (node.node_type === 'send_media') {
    const cfg = node.config as { media_type?: string; caption?: string };
    return (
      <div className={cn('max-w-[85%] rounded-xl px-3 py-2', bubbleTone)}>
        <div className="text-muted-foreground bg-muted mb-1 flex h-16 items-center justify-center rounded-md text-[11px]">
          [{cfg.media_type ?? 'media'}]
        </div>
        {cfg.caption && (
          <p className="text-foreground text-[13px] whitespace-pre-wrap">
            {cfg.caption}
          </p>
        )}
      </div>
    );
  }

  // send_buttons / send_list
  const rendered = renderMenuForChannel(node, channel);
  return (
    <div className="flex max-w-[90%] flex-col gap-1.5">
      <div className={cn('rounded-xl px-3 py-2', bubbleTone)}>
        <p className="text-foreground text-[13px] whitespace-pre-wrap">
          {rendered.body || t('previewNoText')}
        </p>
        {/* WhatsApp native list: a single tap-to-open row under the bubble */}
        {rendered.presentation === 'native_list' && (
          <div className="border-border/60 mt-2 border-t pt-1.5 text-center text-[12px] font-medium text-emerald-700 dark:text-emerald-400">
            {rendered.buttonLabel || t('previewListButton')}
          </div>
        )}
      </div>

      {rendered.presentation === 'native_buttons' && (
        <div className="flex flex-col gap-1">
          {rendered.options.map((o, i) => (
            <div
              key={`${o.reply_id}-${i}`}
              className="rounded-lg border border-emerald-600/30 bg-emerald-50 py-1.5 text-center text-[12.5px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
            >
              {o.title || `#${i + 1}`}
            </div>
          ))}
        </div>
      )}

      {rendered.presentation === 'quick_reply_chips' && (
        <div className="flex flex-wrap gap-1.5">
          {rendered.options.map((o, i) => (
            <span
              key={`${o.reply_id}-${i}`}
              className="rounded-full border border-blue-500/40 bg-blue-50 px-2.5 py-1 text-[12px] font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
            >
              {o.title || `#${i + 1}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
