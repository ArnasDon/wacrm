'use client';

// ============================================================
// DestructiveConfirmDialog — shared "are you sure?" gate for every
// irreversible action in the app (delete config, delete API key,
// delete integration, delete data source, delete KB document, …).
//
// Built on the project's own Dialog primitive (src/components/ui/
// dialog.tsx) — not window.confirm() — so focus handling, keyboard,
// theming and i18n all stay consistent with the rest of the UI.
//
// Contract:
//   - The FIRST click on the trigger button that opens this dialog
//     must NEVER itself call the destructive action. Only clicking
//     `confirmLabel` (or, for a `critical` flow, `critical.confirmLabel`
//     on the SECOND screen) does.
//   - `onConfirm` is the actual destructive operation. It must throw
//     (with a human-readable `message`) on failure and resolve on
//     success — the dialog closes only after a successful resolve, and
//     stays open showing the error otherwise (never pretends success).
//   - Double-clicking the confirm button, or dismissing via Escape/
//     backdrop while the operation is in flight, cannot fire a second
//     request or silently lose the pending state.
//
// `critical` turns this into a two-step flow (Fase 4/6 of the AI
// Agents Setup security pass): the first screen only advances to a
// second screen that names exactly what will be deleted; nothing is
// deleted until the SECOND screen's own confirm button is clicked.
// ============================================================

import { useState, type ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface DestructiveConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  cancelLabel: string;
  /** First-step button label — the destructive action itself for a
   *  simple confirmation, or a non-destructive "Continue" wording when
   *  `critical` is set (that click only reveals the second screen). */
  confirmLabel: string;
  /** The actual destructive operation. Throw an Error with a clear
   *  message on failure; resolve on success. Callers should do their
   *  own success side effects (toast, local state update) before
   *  resolving — the dialog only handles open/close + error display. */
  onConfirm: () => Promise<void>;
  /** Shown when onConfirm rejects with something that has no usable
   *  message (e.g. a bare network exception). */
  errorFallback: string;
  /** When set, requires an explicit second confirmation before
   *  onConfirm ever runs — for actions that also remove credentials or
   *  a complete configuration (Fase 4/5/6). */
  critical?: {
    title: string;
    description: ReactNode;
    confirmLabel: string;
  };
}

export function DestructiveConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
  errorFallback,
  critical,
}: DestructiveConfirmDialogProps) {
  const [step, setStep] = useState<'first' | 'second'>('first');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resetting on OPEN would mean calling setState from inside a
  // useEffect keyed on `open` — exactly the cascading-render pattern
  // React's own hooks lint (react-hooks/set-state-in-effect) flags.
  // Instead every path that closes the dialog (Cancel, Escape/backdrop
  // — both via requestClose below — and a successful delete) resets
  // through this single helper, called only from event handlers, so
  // the NEXT open always starts clean without an effect at all.
  function finishClose() {
    setStep('first');
    setSubmitting(false);
    setError(null);
    onOpenChange(false);
  }

  function requestClose(next: boolean) {
    if (!next) {
      // Ignore an Escape/backdrop/close-button dismissal while a
      // delete is in flight — same "no lost state mid-operation"
      // guarantee the explicit Cancel button respects by being
      // disabled instead.
      if (submitting) return;
      finishClose();
      return;
    }
    onOpenChange(next);
  }

  async function handleConfirmClick() {
    if (submitting) return; // blocks a double-click from firing two DELETEs
    if (critical && step === 'first') {
      setStep('second');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      finishClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : errorFallback);
      setSubmitting(false);
    }
  }

  const onSecondStep = Boolean(critical) && step === 'second';
  const activeTitle = onSecondStep ? critical!.title : title;
  const activeDescription = onSecondStep ? critical!.description : description;
  const activeConfirmLabel = onSecondStep ? critical!.confirmLabel : confirmLabel;

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <DialogTitle className="text-popover-foreground">{activeTitle}</DialogTitle>
          </div>
          <DialogDescription className="text-muted-foreground">
            {activeDescription}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => requestClose(false)}
            disabled={submitting}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={handleConfirmClick} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {activeConfirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
