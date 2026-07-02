"use client";

import Link from "next/link";
import type { ContactJourney, FunnelStage } from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useCan } from "@/hooks/use-can";

interface LeadDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  journey: ContactJourney | null;
  stages: FunnelStage[];
  onMoved: (journeyId: string, newStageId: string) => void;
}

export function LeadDetailSheet({
  open,
  onOpenChange,
  journey,
  stages,
  onMoved,
}: LeadDetailSheetProps) {
  const canMove = useCan("send-messages");

  if (!journey) return null;
  const contact = journey.contact;
  const sortedStages = [...stages].sort((a, b) => a.position - b.position);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-md w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {contact?.name || contact?.phone || "Lead"}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {contact?.phone && (
              <div className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Phone
                </span>
                <span className="text-sm text-foreground">{contact.phone}</span>
              </div>
            )}

            <div className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                In current stage since
              </span>
              <span className="text-sm text-foreground">
                {formatDistanceToNow(new Date(journey.entered_stage_at), {
                  addSuffix: true,
                })}
              </span>
            </div>

            {journey.conversation?.last_message_text && (
              <div className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Last message
                </span>
                <p className="text-sm text-foreground">
                  {journey.conversation.last_message_text}
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Stage
              </span>
              <select
                value={journey.stage_id}
                disabled={!canMove}
                onChange={(e) => onMoved(journey.id, e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
              >
                {sortedStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {journey.conversation?.id && (
              <Link
                href={`/inbox?c=${journey.conversation.id}`}
                className="inline-flex items-center gap-1.5 self-start rounded-md bg-primary/10 px-2 py-1.5 text-xs text-primary hover:bg-primary/20"
              >
                <MessageSquare className="h-3 w-3" />
                View conversation
              </Link>
            )}
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="w-full border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              Close
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
