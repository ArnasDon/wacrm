'use client';

// ============================================================
// /leads — §7's target nav names one "Leads" entry; Rimula's Phase 6
// funnel (Requests -> Leads -> BA routing -> Trials -> Conversions,
// §23) is three related entities, so they live here as tabs rather
// than three separate nav items or a second navigation system.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Tab = 'requests' | 'leads' | 'trials';

interface ContactOption {
  id: string;
  name: string | null;
  phone: string;
}
interface ProductOption {
  id: string;
  product_name: string;
}

interface RequestRow {
  id: string;
  type: string;
  status: string;
  source: string;
  notes: string | null;
  contact: ContactOption | null;
  product: ProductOption | null;
  assignee: { user_id: string; full_name: string | null } | null;
  routing_reason: string | null;
  deal_id: string | null;
  created_at: string;
}

interface LeadRow {
  id: string;
  title: string;
  value: number;
  currency: string | null;
  status: string;
  source: string | null;
  next_follow_up: string | null;
  outcome: string | null;
  contact: ContactOption | null;
  assignee: { id: string; user_id: string; full_name: string | null } | null;
  routing_reason: string | null;
  created_at: string;
}

interface TrialRow {
  id: string;
  name: string | null;
  phone: string;
  status: string;
  market: string | null;
  vehicle: string | null;
  contact: ContactOption | null;
  product: ProductOption | null;
  assigned_ba_id: string | null;
  routing_reason: string | null;
  created_at: string;
}

const REQUEST_TYPES = [
  'PRODUCT_INFORMATION',
  'PRODUCT_SUITABILITY',
  'TRIAL_REQUEST',
  'BA_CALL_REQUEST',
  'PRODUCT_QUESTION',
  'FEEDBACK',
  'PURCHASE_REQUEST',
  'CONVERSION_REQUEST',
  'GENERAL_ENQUIRY',
];
const REQUEST_STATUSES = [
  'NEW',
  'ASSIGNED',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
];
const LEAD_STATUSES = [
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'INTERESTED',
  'TRIAL_REQUESTED',
  'TRIAL_COMPLETED',
  'CONVERTED',
  'LOST',
];
const TRIAL_STATUSES = [
  'NEW',
  'REQUESTED',
  'ASSIGNED',
  'SCHEDULED',
  'COMPLETED',
  'CONVERTED',
  'CANCELLED',
];

export default function LeadsPage() {
  const { loading: authLoading, accountId, canSendMessages } = useAuth();
  const supabase = createClient();

  const [tab, setTab] = useState<Tab>('requests');
  const [mineOnly, setMineOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [trials, setTrials] = useState<TrialRow[]>([]);

  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  const [newTrialOpen, setNewTrialOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = mineOnly ? '?mine=true' : '';
      if (tab === 'requests') {
        const res = await fetch(`/api/customer-requests${qs}`);
        const data = await res.json();
        if (res.ok) setRequests(data.customer_requests ?? []);
      } else if (tab === 'leads') {
        const res = await fetch(`/api/leads${qs}`);
        const data = await res.json();
        if (res.ok) setLeads(data.leads ?? []);
      } else {
        const res = await fetch(`/api/trials${qs}`);
        const data = await res.json();
        if (res.ok) setTrials(data.trials ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [tab, mineOnly]);

  useEffect(() => {
    if (authLoading || !accountId) return;
    void load();
  }, [authLoading, accountId, load]);

  useEffect(() => {
    if (authLoading || !accountId) return;
    (async () => {
      const [{ data: c }, prodRes] = await Promise.all([
        supabase.from('contacts').select('id, name, phone').order('name'),
        fetch('/api/products').then((r) => r.json()),
      ]);
      setContacts((c ?? []) as ContactOption[]);
      setProducts(prodRes.products ?? []);
    })();
  }, [authLoading, accountId, supabase]);

  async function updateRequestStatus(id: string, status: string) {
    const res = await fetch(`/api/customer-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      toast.error('Failed to update status');
      return;
    }
    void load();
  }

  async function updateLeadStatus(id: string, status: string) {
    const res = await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      toast.error('Failed to update status');
      return;
    }
    void load();
  }

  async function updateTrialStatus(id: string, status: string) {
    const res = await fetch(`/api/trials/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      toast.error('Failed to update status');
      return;
    }
    void load();
  }

  async function convertRequest(id: string) {
    const res = await fetch(`/api/customer-requests/${id}/convert`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? 'Failed to convert to Lead');
      return;
    }
    toast.success('Converted to Lead');
    setTab('leads');
    void load();
  }

  async function handleNewRequest(form: FormData) {
    setSaving(true);
    const body = {
      type: form.get('type'),
      contact_id: form.get('contact_id') || undefined,
      product_id: form.get('product_id') || undefined,
      notes: form.get('notes') || undefined,
      source: 'manual',
    };
    const res = await fetch('/api/customer-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? 'Failed to create request');
      return;
    }
    toast.success('Request created');
    setNewRequestOpen(false);
    void load();
  }

  async function handleNewTrial(form: FormData) {
    setSaving(true);
    const body = {
      phone: form.get('phone'),
      name: form.get('name') || undefined,
      contact_id: form.get('contact_id') || undefined,
      product_id: form.get('product_id') || undefined,
      market: form.get('market') || undefined,
      vehicle: form.get('vehicle') || undefined,
      notes: form.get('notes') || undefined,
    };
    const res = await fetch('/api/trials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? 'Failed to create trial');
      return;
    }
    toast.success('Trial created');
    setNewTrialOpen(false);
    void load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Leads</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Customer Requests → Leads → BA routing → Trials → Conversions (§12).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
              className="border-border size-4 rounded"
            />
            My queue only
          </label>
          {tab === 'requests' && canSendMessages && (
            <Button size="sm" onClick={() => setNewRequestOpen(true)}>
              <Plus className="size-4" />
              New Request
            </Button>
          )}
          {tab === 'trials' && canSendMessages && (
            <Button size="sm" onClick={() => setNewTrialOpen(true)}>
              <Plus className="size-4" />
              New Trial
            </Button>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="trials">Trials</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="text-muted-foreground flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : tab === 'requests' ? (
        requests.length === 0 ? (
          <EmptyState label="No customer requests yet." />
        ) : (
          <div className="border-border rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned BA</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-foreground text-sm">
                      {r.type.replaceAll('_', ' ')}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {r.contact?.name ?? r.contact?.phone ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {r.product?.product_name ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatusSelect
                        value={r.status}
                        options={REQUEST_STATUSES}
                        disabled={!canSendMessages}
                        onChange={(v) => updateRequestStatus(r.id, v)}
                      />
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground text-sm"
                      title={r.routing_reason ?? ''}
                    >
                      {r.assignee?.full_name ?? 'Unassigned'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(r.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {!r.deal_id && r.contact && canSendMessages && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => convertRequest(r.id)}
                        >
                          Convert <ArrowRight className="size-3.5" />
                        </Button>
                      )}
                      {r.deal_id && <Badge variant="outline">Converted</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : tab === 'leads' ? (
        leads.length === 0 ? (
          <EmptyState label="No Leads yet." />
        ) : (
          <div className="border-border rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned BA</TableHead>
                  <TableHead>Follow-up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-foreground text-sm font-medium">
                      {l.title}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {l.contact?.name ?? l.contact?.phone ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {l.currency ? `${l.currency} ${l.value}` : l.value}
                    </TableCell>
                    <TableCell>
                      <StatusSelect
                        value={l.status}
                        options={LEAD_STATUSES}
                        disabled={!canSendMessages}
                        onChange={(v) => updateLeadStatus(l.id, v)}
                      />
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground text-sm"
                      title={l.routing_reason ?? ''}
                    >
                      {l.assignee?.full_name ?? 'Unassigned'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {l.next_follow_up
                        ? new Date(l.next_follow_up).toLocaleDateString()
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : trials.length === 0 ? (
        <EmptyState label="No Trials yet." />
      ) : (
        <div className="border-border rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trials.map((tr) => (
                <TableRow key={tr.id}>
                  <TableCell className="text-foreground text-sm">
                    {tr.name ?? tr.contact?.name ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {tr.phone}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {tr.product?.product_name ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {tr.vehicle ?? '—'}
                  </TableCell>
                  <TableCell>
                    <StatusSelect
                      value={tr.status}
                      options={TRIAL_STATUSES}
                      disabled={!canSendMessages}
                      onChange={(v) => updateTrialStatus(tr.id, v)}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(tr.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* New Request dialog */}
      <Dialog open={newRequestOpen} onOpenChange={setNewRequestOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              New Customer Request
            </DialogTitle>
          </DialogHeader>
          <form
            id="new-request-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleNewRequest(new FormData(e.currentTarget));
            }}
            className="space-y-3 py-2"
          >
            <div>
              <Label className="text-muted-foreground">Type</Label>
              <select
                name="type"
                required
                className="border-border bg-muted text-foreground focus:border-primary mt-1.5 h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
              >
                {REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-muted-foreground">Member</Label>
              <select
                name="contact_id"
                className="border-border bg-muted text-foreground focus:border-primary mt-1.5 h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
              >
                <option value="">— None yet —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.phone}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-muted-foreground">Product</Label>
              <select
                name="product_id"
                className="border-border bg-muted text-foreground focus:border-primary mt-1.5 h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
              >
                <option value="">— None —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.product_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-muted-foreground">Notes</Label>
              <Textarea
                name="notes"
                className="bg-muted border-border text-foreground mt-1.5"
              />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewRequestOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="new-request-form" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Trial dialog */}
      <Dialog open={newTrialOpen} onOpenChange={setNewTrialOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              New Trial Request
            </DialogTitle>
          </DialogHeader>
          <form
            id="new-trial-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleNewTrial(new FormData(e.currentTarget));
            }}
            className="space-y-3 py-2"
          >
            <div>
              <Label className="text-muted-foreground">Phone</Label>
              <Input
                name="phone"
                required
                className="bg-muted border-border text-foreground mt-1.5"
              />
            </div>
            <div>
              <Label className="text-muted-foreground">Name</Label>
              <Input
                name="name"
                className="bg-muted border-border text-foreground mt-1.5"
              />
            </div>
            <div>
              <Label className="text-muted-foreground">Member</Label>
              <select
                name="contact_id"
                className="border-border bg-muted text-foreground focus:border-primary mt-1.5 h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
              >
                <option value="">— None yet —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.phone}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-muted-foreground">Product</Label>
              <select
                name="product_id"
                className="border-border bg-muted text-foreground focus:border-primary mt-1.5 h-9 w-full rounded-lg border px-2.5 text-sm outline-none"
              >
                <option value="">— None —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.product_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-muted-foreground">Vehicle</Label>
              <Input
                name="vehicle"
                className="bg-muted border-border text-foreground mt-1.5"
              />
            </div>
            <div>
              <Label className="text-muted-foreground">Notes</Label>
              <Textarea
                name="notes"
                className="bg-muted border-border text-foreground mt-1.5"
              />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTrialOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="new-trial-form" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="border-border bg-muted text-foreground focus:border-primary h-8 rounded-md border px-2 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o.replaceAll('_', ' ')}
        </option>
      ))}
    </select>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="border-border flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <p className="text-muted-foreground text-sm">{label}</p>
    </div>
  );
}
