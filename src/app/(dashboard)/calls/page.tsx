"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Phone,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CallLog, CallStatus } from "@/types";

type CallRow = CallLog & {
  contact?: { id: string; name: string | null; phone: string | null } | null;
};

const STATUS_LABEL: Record<CallStatus, string> = {
  initiated: "Initiated",
  ringing: "Ringing",
  connected: "In progress",
  completed: "Completed",
  missed: "Missed",
  declined: "Declined",
  failed: "Failed",
};

function statusClass(status: CallStatus): string {
  switch (status) {
    case "completed":
      return "text-green-600";
    case "missed":
    case "failed":
      return "text-destructive";
    case "declined":
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function CallDirectionIcon({ row }: { row: CallRow }) {
  if (row.status === "missed") {
    return <PhoneMissed className="size-4 text-destructive" />;
  }
  if (row.direction === "outbound") {
    return <PhoneOutgoing className="size-4 text-muted-foreground" />;
  }
  return <PhoneIncoming className="size-4 text-muted-foreground" />;
}

export default function CallsPage() {
  const supabase = createClient();
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("call_logs")
      .select("*, contact:contacts(id, name, phone)")
      .order("started_at", { ascending: false })
      .limit(200);
    if (!error && data) setCalls(data as CallRow[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // Setters in load() run after the Supabase await, not synchronously
    // in the effect body, so the cascade this rule guards against doesn't
    // apply — same pattern as the contacts/inbox pages.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Live-refresh on any call_logs change (RLS-scoped to this account).
    const channel = supabase
      .channel("calls-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_logs" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center gap-3">
        <Phone className="size-5 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold">Calls</h1>
          <p className="text-sm text-muted-foreground">
            WhatsApp voice call history.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : calls.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Phone className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">No calls yet</p>
          <p className="text-xs text-muted-foreground">
            Inbound WhatsApp calls will appear here once calling is enabled
            on your number.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.map((row) => {
                const name =
                  row.contact?.name || row.contact?.phone || "Unknown";
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <CallDirectionIcon row={row} />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={`/inbox?c=${row.conversation_id}`}
                        className="hover:underline"
                      >
                        {name}
                      </Link>
                    </TableCell>
                    <TableCell className={cn("text-sm", statusClass(row.status))}>
                      {STATUS_LABEL[row.status]}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDuration(row.duration_seconds)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(row.started_at), {
                        addSuffix: true,
                      })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
