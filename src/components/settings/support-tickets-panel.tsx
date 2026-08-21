'use client';

// ============================================================
// Settings → Tickets
//
// Lets any account member (viewer+, same role floor as who can submit
// a report in the first place — see POST /api/support/report) see
// every "Reportar un problema" ticket their COMPANY has filed, its
// status, and any note Angel (platform admin) has left on it from
// /admin. Reuses the RLS policy support_tickets_select (migration
// 078), which widened from "only the exact reporter" to "any member
// of that account" — so this queries support_tickets directly via the
// RLS-scoped client, the same pattern billing.tsx uses for its own
// account-scoped read.
// ============================================================

import { useEffect, useState } from 'react';
import { LifeBuoy, Loader2, MessageSquare, Plus } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SupportReportDialog } from '@/components/layout/support-report-dialog';

interface SupportTicket {
  id: string;
  ticket_number: number;
  description: string;
  status: 'open' | 'resolved';
  admin_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

export function SupportTicketsPanel() {
  const { accountId, profile } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  // Bumped after the report dialog closes, so the effect below refetches
  // to pick up a newly-created ticket — same pattern as ConversationList's
  // resyncToken, avoids calling a state-setting function directly from an
  // effect body.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await createClient()
        .from('support_tickets')
        .select('id, ticket_number, description, status, admin_note, created_at, resolved_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      setTickets((data as SupportTicket[] | null) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, reloadToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <LifeBuoy className="text-primary size-4" />
                Tickets
              </CardTitle>
              <CardDescription>
                Los problemas que tu equipo ha reportado y su estado.
              </CardDescription>
            </div>
            <Button size="sm" className="gap-2" onClick={() => setReportOpen(true)}>
              <Plus className="size-4" />
              Reportar un problema
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Todavía no has reportado ningún problema.
            </p>
          ) : (
            <div className="space-y-3">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="border-border bg-muted/50 space-y-2 rounded-lg border p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-foreground text-sm font-medium">
                      Ticket #{ticket.ticket_number}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs">
                        {new Date(ticket.created_at).toLocaleDateString('es-GT')}
                      </span>
                      <span
                        className={
                          ticket.status === 'resolved'
                            ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-500'
                            : 'rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500'
                        }
                      >
                        {ticket.status === 'resolved' ? 'Solucionado' : 'Abierto'}
                      </span>
                    </div>
                  </div>
                  <p className="text-foreground text-sm whitespace-pre-wrap">
                    {ticket.description}
                  </p>
                  {ticket.admin_note ? (
                    <div className="border-border bg-background flex gap-2 rounded-md border p-2.5">
                      <MessageSquare className="text-primary size-4 shrink-0" />
                      <div>
                        <p className="text-muted-foreground text-xs font-medium">
                          Nota del equipo de Chat Sandía
                        </p>
                        <p className="text-foreground text-sm whitespace-pre-wrap">
                          {ticket.admin_note}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <SupportReportDialog
        open={reportOpen}
        onOpenChange={(next) => {
          setReportOpen(next);
          if (!next) setReloadToken((n) => n + 1);
        }}
        defaultName={profile?.full_name ?? ''}
      />
    </div>
  );
}
