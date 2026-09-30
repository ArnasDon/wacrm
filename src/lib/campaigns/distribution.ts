// ============================================================
// Splitting a campaign's audience over channel × template pairs.
//
// A campaign has, per channel, the templates chosen for it. The
// distribution mode decides each pair's share:
//
//   channel   every channel carries an equal share; inside a channel,
//             its templates split that share equally
//   template  every template carries an equal share; inside a template,
//             the channels that have it split that share equally
//   matrix    every channel × template pair carries an equal share
//
// planDistribution() turns shares into whole recipient counts (largest
// remainder, so they always add up to the total), and assignPairs()
// interleaves them so any prefix of the audience — what goes out first —
// is already split the same way. Pure; used by the wizard (to show the
// split) and the create route (to stamp each recipient).
// ============================================================

import { templateKey, type CampaignTemplateRef } from './advanced';

export type DistributionMode = 'channel' | 'template' | 'matrix';

export interface SendPair {
  channelId: string;
  template: CampaignTemplateRef;
  /** templateKey(template) */
  key: string;
}

export interface PairPlan extends SendPair {
  count: number;
}

/** Every channel × chosen-template pair, in channel then template order. */
export function buildPairs(
  channelIds: string[],
  channelTemplates: Record<string, CampaignTemplateRef[]>
): SendPair[] {
  return channelIds.flatMap((channelId) =>
    (channelTemplates[channelId] ?? []).map((template) => ({
      channelId,
      template,
      key: templateKey(template),
    }))
  );
}

function weights(pairs: SendPair[], mode: DistributionMode): number[] {
  if (pairs.length === 0) return [];
  if (mode === 'matrix') return pairs.map(() => 1 / pairs.length);
  if (mode === 'channel') {
    const channels = new Map<string, number>();
    for (const p of pairs)
      channels.set(p.channelId, (channels.get(p.channelId) ?? 0) + 1);
    return pairs.map((p) => 1 / channels.size / channels.get(p.channelId)!);
  }
  const templates = new Map<string, number>();
  for (const p of pairs) templates.set(p.key, (templates.get(p.key) ?? 0) + 1);
  return pairs.map((p) => 1 / templates.size / templates.get(p.key)!);
}

/** Whole recipient counts per pair, summing exactly to `total`. */
export function planDistribution(
  pairs: SendPair[],
  mode: DistributionMode,
  total: number
): PairPlan[] {
  const w = weights(pairs, mode);
  const exact = w.map((x) => x * Math.max(0, total));
  const counts = exact.map(Math.floor);
  let left = Math.max(0, total) - counts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--)
    counts[order[k].i]++;
  return pairs.map((p, i) => ({ ...p, count: counts[i] }));
}

/**
 * The pair for each recipient, in order, interleaved (smooth weighted
 * round-robin) so every stretch of the audience keeps the planned split.
 */
export function assignPairs(plan: PairPlan[]): SendPair[] {
  const total = plan.reduce((a, p) => a + p.count, 0);
  const remaining = plan.map((p) => p.count);
  const credit = plan.map(() => 0);
  const out: SendPair[] = [];
  for (let n = 0; n < total; n++) {
    let best = -1;
    for (let i = 0; i < plan.length; i++) {
      if (remaining[i] === 0) continue;
      credit[i] += plan[i].count;
      if (best < 0 || credit[i] > credit[best]) best = i;
    }
    credit[best] -= total;
    remaining[best]--;
    const { channelId, template, key } = plan[best];
    out.push({ channelId, template, key });
  }
  return out;
}

/** Receivers + template count per channel, for the split cards. */
export function channelTotals(
  plan: PairPlan[]
): Map<string, { receivers: number; templates: number }> {
  const out = new Map<string, { receivers: number; templates: number }>();
  for (const p of plan) {
    const t = out.get(p.channelId) ?? { receivers: 0, templates: 0 };
    t.receivers += p.count;
    t.templates += 1;
    out.set(p.channelId, t);
  }
  return out;
}
