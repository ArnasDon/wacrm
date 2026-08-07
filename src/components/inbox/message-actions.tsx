"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Copy, CornerUpLeft, Forward, SmilePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Message } from "@/types";
import { useTranslations } from "next-intl";
import { ForwardMessageDialog } from "./forward-message-dialog";

// WhatsApp's own quick-reaction bar starts with these six. Picking the same
// set keeps the affordance familiar without pulling in a 300KB emoji library.
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// Content types the "Copiar"/"Apagar"/"Encaminhar" menu items apply to —
// mirrors the equivalent gates in the composer and, for forward, the
// server-side check in /api/whatsapp/forward. Location/template/
// interactive messages don't have a plain resendable/copyable body.
const FORWARDABLE_TYPES = new Set(["text", "image", "video", "document", "audio"]);
const DELETABLE_TYPES = FORWARDABLE_TYPES;

interface MessageActionsProps {
  message: Message;
  onReply: () => void;
  onReact: (emoji: string) => void;
  /** Delete this (agent-sent) message. Awaited so the confirm dialog can
   *  show a spinner and stay open on failure. */
  onDelete: () => Promise<void> | void;
  children: ReactNode;
}

/**
 * Hover toolbar + right-click/long-press context menu wrapper around a
 * `<MessageBubble>`. The bubble itself stays a pure presenter — this
 * component owns the action surface so the bubble's render path is
 * unaffected when nothing is open.
 *
 * Two ways in, same menu: hovering (desktop) reveals a small chevron
 * next to the reaction picker; clicking it opens the context menu. A
 * right-click (desktop) or long-press (mobile — the browser fires
 * `contextmenu` for that natively) opens the exact same menu directly,
 * anchored to the bubble, without needing the hover step first.
 */
export function MessageActions({
  message,
  onReply,
  onReact,
  onDelete,
  children,
}: MessageActionsProps) {
  const t = useTranslations("Inbox.actions");

  // Touch devices have no hover. Long-press fires `contextmenu`; we capture
  // it, suppress the native menu, and pin the toolbar row open until the
  // user interacts elsewhere (mirrors the reaction-picker's own reveal).
  const [touchOpen, setTouchOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);

  const isAgent =
    message.sender_type === "agent" || message.sender_type === "bot";
  const canCopy = message.content_type === "text";
  const canForward = FORWARDABLE_TYPES.has(message.content_type);
  const canDelete = isAgent && DELETABLE_TYPES.has(message.content_type);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(true);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete();
      setDeleteConfirmOpen(false);
    } catch {
      toast.error(t("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleCopy = async () => {
    const text = message.content_text ?? "";
    if (!text) {
      toast.error(t("nothingToCopy"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const handlePickEmoji = (emoji: string) => {
    onReact(emoji);
    setPickerOpen(false);
    setTouchOpen(false);
  };

  // Row alignment lives here (not in MessageBubble) so the `group/actions`
  // hover region matches the bubble's content width — hovering empty space
  // in the row no longer reveals the toolbar.
  return (
    <div
      className={cn(
        "flex w-full",
        isAgent ? "justify-end" : "justify-start",
      )}
      onContextMenu={handleContextMenu}
      onBlur={() => setTouchOpen(false)}
    >
      {/* `min-w-0` lets this flex child actually respect the 75% cap.
       *  Default `min-width: auto` lets content (a long quote preview,
       *  an unbroken URL) push past the cap and shove the row past
       *  100%, which used to bleed across into the contact-sidebar
       *  area. See issue #165. */}
      <div className="group/actions relative min-w-0 max-w-[75%]">
        {children}
      <div
        data-touch-open={touchOpen || pickerOpen || menuOpen ? "true" : undefined}
        className={cn(
          "absolute -top-3 z-10 flex h-7 items-center gap-0.5 rounded-full border border-border bg-popover/95 px-1 shadow-md backdrop-blur-sm transition-opacity",
          "opacity-0 group-hover/actions:opacity-100 group-focus-within/actions:opacity-100",
          "data-[touch-open=true]:opacity-100",
          isAgent ? "right-3" : "left-3",
        )}
      >
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("react")}
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </PopoverTrigger>
          <PopoverContent
            className="flex w-auto flex-row gap-1 p-1.5"
            sideOffset={6}
          >
            {QUICK_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => handlePickEmoji(e)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none transition-transform hover:scale-125 hover:bg-muted"
                aria-label={t("reactWith", { emoji: e })}
              >
                {e}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Context menu trigger — the small chevron is the discoverable
            desktop affordance; onContextMenu on the row above (right-
            click / long-press) opens this same controlled menu without
            it, jumping straight past the hover step. */}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("openMenu")}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align={isAgent ? "end" : "start"}>
            <DropdownMenuItem onClick={onReply}>
              <CornerUpLeft />
              {t("reply")}
            </DropdownMenuItem>
            {canForward && (
              <DropdownMenuItem onClick={() => setForwardOpen(true)}>
                <Forward />
                {t("forward")}
              </DropdownMenuItem>
            )}
            {canCopy && (
              <DropdownMenuItem onClick={handleCopy}>
                <Copy />
                {t("copyText")}
              </DropdownMenuItem>
            )}
            {/* WhatsApp only lets you delete messages you sent — never
                the other party's. */}
            {canDelete && (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2 />
                {t("deleteMessage")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("deleteConfirmDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deleting}
            >
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {t("deleteConfirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ForwardMessageDialog
        message={forwardOpen ? message : null}
        open={forwardOpen}
        onOpenChange={setForwardOpen}
      />
    </div>
  );
}
