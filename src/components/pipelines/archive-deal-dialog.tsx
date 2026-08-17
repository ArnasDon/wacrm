"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface ArchiveDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string | null;
  dealName: string;
  /** Called after a successful archive, before the dialog closes — the
   *  caller owns removing the card from its local `deals` list. */
  onArchived: (dealId: string) => void;
}

/**
 * "Arquivar" confirmation — same structural pattern as
 * DeleteLeadDialog, but non-destructive: only sets `archived_at`
 * (migration 067), never touches the contact/deal row itself. Reachable
 * from the Pipeline card's "⋮" menu.
 */
export function ArchiveDealDialog({
  open,
  onOpenChange,
  dealId,
  dealName,
  onArchived,
}: ArchiveDealDialogProps) {
  const t = useTranslations("Pipelines.archiveDialog");
  const [archiving, setArchiving] = useState(false);

  async function handleArchive() {
    if (!dealId) return;
    setArchiving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("deals")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", dealId);

    if (error) {
      console.error("[archive-deal] failed:", error);
      toast.error(t("toastFailedArchive"));
    } else {
      toast.success(t("toastArchived"));
      onArchived(dealId);
      onOpenChange(false);
    }
    setArchiving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t("title", { name: dealName })}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("description")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={archiving}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button onClick={handleArchive} disabled={archiving || !dealId}>
            {archiving && <Loader2 className="size-4 animate-spin" />}
            {archiving ? t("archiving") : t("archiveBtn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
