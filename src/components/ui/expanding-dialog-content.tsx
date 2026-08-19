"use client";

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFlipTransition } from "@/hooks/use-flip-transition";
import { cn } from "@/lib/utils";

interface ExpandingDialogContentProps {
  /** The clicked card's own bounding box, captured at click time — see
   *  `useFlipTransition`. */
  originRect?: DOMRect | null;
  className?: string;
  children: ReactNode;
  showCloseButton?: boolean;
}

/**
 * The one shared "card grows into its detail view" popup shell — every
 * card → detail dialog in the app renders this instead of the default
 * centered fade+zoom `<DialogContent>`, so the open/close motion and
 * its correctness fix (see `useFlipTransition`) live in exactly one
 * place. Always used inside the normal `<Dialog><DialogPortal>
 * <DialogOverlay/>...</DialogPortal></Dialog>` structure — Portal/
 * Overlay/Title/Description/Footer stay the same shared pieces every
 * other dialog uses; only the Popup itself is bespoke.
 */
export function ExpandingDialogContent({
  originRect,
  className,
  children,
  showCloseButton = true,
}: ExpandingDialogContentProps) {
  const ref = useFlipTransition({ originRect });

  return (
    <DialogPrimitive.Popup
      ref={ref}
      data-slot="expanding-dialog-content"
      className={cn(
        "flip-modal-popup fixed top-1/2 left-1/2 z-50 grid max-h-[85vh] w-full max-w-[calc(100%-2rem)] gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-md",
        className,
      )}
    >
      {showCloseButton && (
        <DialogPrimitive.Close
          data-slot="dialog-close"
          render={
            <Button
              variant="ghost"
              // z-10 — cheap safety margin so this absolutely-positioned
              // button always stays above the content flowing beneath it.
              className="absolute top-2 right-2 z-10"
              size="icon-sm"
            />
          }
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
      {children}
    </DialogPrimitive.Popup>
  );
}
