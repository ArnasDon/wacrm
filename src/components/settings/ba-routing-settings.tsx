'use client';

// ============================================================
// Settings -> BA routing (§12, §15)
//
//   1. Strategy card — which of §12's three strategies
//      `LeadRoutingService` (src/lib/routing/service.ts) uses:
//      round_robin / lowest_open_leads / manual. Admin+ only, same
//      tier as `ba_routing_settings` RLS (migration 056).
//   2. BA roster — per-member region/market/capacity/status/
//      languages (§9.1's BA field set, migration 051). Goes through
//      `PATCH /api/account/members/[userId]/ba-profile`, which itself
//      goes through the `set_ba_profile_fields` RPC — `profiles_update`
//      RLS only lets a user edit their own row, so an admin editing a
//      teammate's BA fields has no other path (see that route's
//      header for the full rationale).
//
// Markets/regions have no dedicated management UI yet (§15 lists them
// as their own Settings area, not built in this phase) — the pickers
// below read `markets`/`regions` directly via the RLS-scoped client
// (any member can SELECT, migration 049) and show a hint if the
// account has none configured yet.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Route, UsersRound } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { SettingsPanelHead } from './settings-panel-head';
import type { AccountMember } from '@/types';

const STRATEGIES = [
  { value: 'lowest_open_leads', label: 'Lowest open-lead count' },
  { value: 'round_robin', label: 'Round robin' },
  { value: 'manual', label: 'Manual only (no auto-assignment)' },
] as const;
const BA_STATUSES = ['active', 'inactive', 'on_leave'] as const;
const LANGUAGES = [
  { code: 'ur', label: 'Urdu' },
  { code: 'ps', label: 'Pashto' },
  { code: 'pa', label: 'Punjabi (Shahmukhi)' },
  { code: 'ur-Roman', label: 'Roman Urdu' },
] as const;

interface LookupOption {
  id: string;
  name: string;
}

export function BaRoutingSettings() {
  const { accountId, canEditSettings, profileLoading } = useAuth();
  const supabase = createClient();

  const [strategy, setStrategy] = useState('lowest_open_leads');
  const [savedStrategy, setSavedStrategy] = useState('lowest_open_leads');
  const [savingStrategy, setSavingStrategy] = useState(false);

  const [members, setMembers] = useState<AccountMember[]>([]);
  const [regions, setRegions] = useState<LookupOption[]>([]);
  const [markets, setMarkets] = useState<LookupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stratRes, membersRes, regionsRes, marketsRes] = await Promise.all([
        fetch('/api/settings/ba-routing').then((r) => r.json()),
        fetch('/api/account/members').then((r) => r.json()),
        supabase.from('regions').select('id, name').order('name'),
        supabase.from('markets').select('id, name').order('name'),
      ]);
      setStrategy(stratRes.strategy ?? 'lowest_open_leads');
      setSavedStrategy(stratRes.strategy ?? 'lowest_open_leads');
      setMembers(membersRes.members ?? []);
      setRegions((regionsRes.data ?? []) as LookupOption[]);
      setMarkets((marketsRes.data ?? []) as LookupOption[]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (profileLoading || !accountId) return;
    void load();
  }, [profileLoading, accountId, load]);

  async function saveStrategy() {
    setSavingStrategy(true);
    const res = await fetch('/api/settings/ba-routing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy }),
    });
    setSavingStrategy(false);
    if (!res.ok) {
      toast.error('Failed to save routing strategy');
      return;
    }
    setSavedStrategy(strategy);
    toast.success('Routing strategy saved');
  }

  async function saveBaProfile(userId: string, form: FormData) {
    setSaving(true);
    const languages = LANGUAGES.filter(
      (l) => form.get(`lang_${l.code}`) === 'on'
    ).map((l) => l.code);
    const body = {
      region_id: (form.get('region_id') as string) || null,
      market_id: (form.get('market_id') as string) || null,
      ba_status: form.get('ba_status'),
      capacity: Number(form.get('capacity')),
      languages,
    };
    const res = await fetch(`/api/account/members/${userId}/ba-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? 'Failed to save BA profile');
      return;
    }
    toast.success('BA profile updated');
    setEditingId(null);
    void load();
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 max-w-3xl space-y-6 duration-200">
      <SettingsPanelHead
        title="BA routing"
        description="Configure how new requests, leads, and trials are assigned to Business Advisors (§12)."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Route className="text-primary size-4" />
            Routing strategy
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Market BA → Regional BA → Unassigned, per this strategy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-sm">
            <Label className="text-muted-foreground">Strategy</Label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              disabled={!canEditSettings}
              className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {!canEditSettings && (
              <p className="text-muted-foreground text-xs">
                Only admins can change this.
              </p>
            )}
          </div>
          {canEditSettings && (
            <Button
              onClick={saveStrategy}
              disabled={savingStrategy || strategy === savedStrategy}
            >
              {savingStrategy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Save'
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <UsersRound className="text-primary size-4" />
            Business Advisors
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Region, market, capacity, and languages drive routing (§9.1). Open
            leads are maintained automatically as requests/leads/trials are
            assigned and closed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {regions.length === 0 && markets.length === 0 && (
            <p className="text-muted-foreground text-xs">
              No markets or regions are configured yet — routing will fall back
              to the Unassigned queue until at least one exists.
            </p>
          )}
          {members.map((m) => (
            <div
              key={m.user_id}
              className="border-border rounded-lg border p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-foreground text-sm font-medium">
                    {m.full_name || m.email}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {m.ba?.region_name ?? 'No region'} ·{' '}
                    {m.ba?.market_name ?? 'No market'} · {m.ba?.open_leads ?? 0}
                    /{m.ba?.capacity ?? 0} open leads ·{' '}
                    {m.ba?.ba_status ?? 'active'}
                  </p>
                </div>
                {canEditSettings && editingId !== m.user_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingId(m.user_id)}
                  >
                    Edit
                  </Button>
                )}
              </div>

              {editingId === m.user_id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveBaProfile(
                      m.user_id,
                      new FormData(e.currentTarget)
                    );
                  }}
                  className="mt-3 grid gap-3 sm:grid-cols-2"
                >
                  <div>
                    <Label className="text-muted-foreground text-xs">
                      Region
                    </Label>
                    <select
                      name="region_id"
                      defaultValue={m.ba?.region_id ?? ''}
                      className="border-border bg-muted text-foreground mt-1 h-8 w-full rounded-md border px-2 text-xs"
                    >
                      <option value="">— None —</option>
                      {regions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">
                      Market
                    </Label>
                    <select
                      name="market_id"
                      defaultValue={m.ba?.market_id ?? ''}
                      className="border-border bg-muted text-foreground mt-1 h-8 w-full rounded-md border px-2 text-xs"
                    >
                      <option value="">— None —</option>
                      {markets.map((mk) => (
                        <option key={mk.id} value={mk.id}>
                          {mk.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">
                      Capacity
                    </Label>
                    <input
                      type="number"
                      name="capacity"
                      min={0}
                      defaultValue={m.ba?.capacity ?? 10}
                      className="border-border bg-muted text-foreground mt-1 h-8 w-full rounded-md border px-2 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">
                      Status
                    </Label>
                    <select
                      name="ba_status"
                      defaultValue={m.ba?.ba_status ?? 'active'}
                      className="border-border bg-muted text-foreground mt-1 h-8 w-full rounded-md border px-2 text-xs"
                    >
                      {BA_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-muted-foreground text-xs">
                      Languages
                    </Label>
                    <div className="mt-1 flex flex-wrap gap-3">
                      {LANGUAGES.map((l) => (
                        <label
                          key={l.code}
                          className="text-foreground flex items-center gap-1.5 text-xs"
                        >
                          <input
                            type="checkbox"
                            name={`lang_${l.code}`}
                            defaultChecked={m.ba?.languages?.includes(l.code)}
                            className="border-border size-3.5 rounded"
                          />
                          {l.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 sm:col-span-2">
                    <Button type="submit" size="sm" disabled={saving}>
                      {saving ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        'Save'
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
