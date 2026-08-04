"use client";

// ============================================================
// GatedButton — Button + role-gated "Read-only" tooltip helper.
//
// The wider problem this solves:
//
//   A bare `<Button disabled title="Read-only — ...">` doesn't
//   render a tooltip in Safari or older Firefox because those
//   browsers don't fire mouse events on disabled form controls.
//   Title attributes only render when the element receives a
//   mouseover. The 9-PR multi-user series relied on this pattern
//   for every "read-only for viewer" CTA across the app, which
//   meant viewers on those browsers saw a silently-disabled
//   button with no explanation.
//
//   Wrapping the disabled button in a `<span title=...>` makes
//   the tooltip target a non-disabled ancestor that does receive
//   mouseover, so the tooltip renders everywhere. The span also
//   serves as a single mounting point for `aria-label` /
//   `aria-disabled` if a screen reader needs richer signalling
//   later.
//
// The minor problem it also solves:
//
//   Five list pages had near-identical
//   `READ_ONLY_TITLE = "Read-only — your role can't ..."`
//   constants. GatedButton takes a single `gateReason` prop
//   and centralises the tooltip wording (with per-action
//   defaults).
//
// Use it like:
//
//   <GatedButton
//     canAct={canCreate}
//     gateReason="create broadcasts"
//     onClick={() => router.push("/broadcasts/new")}
//   >
//     <Plus className="h-4 w-4" /> New Broadcast
//   </GatedButton>
//
// `canAct` defaults to true so unrelated usages still work.
// When `canAct` is false, the button is `disabled` and the
// wrapping span gets a `title` of `"Read-only — your role
// can't ${gateReason}"`.
// ============================================================

import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface GatedButtonProps extends Omit<ComponentProps<typeof Button>, "title"> {
  /** False → button is disabled and the wrapper span shows the
   *  "Read-only" tooltip. Defaults to `true` so a `<GatedButton>`
   *  without the prop is just a Button. */
  canAct?: boolean;
  /** Verb phrase that completes the sentence
   *  `"Read-only — your role can't <gateReason>"`. Provided
   *  per-call so each CTA can name what it does ("create flows",
   *  "send messages", "add contacts"). */
  gateReason?: string;
  /** Optional fallback title for the non-gated case. */
  title?: string;
  children?: ReactNode;
}

export function GatedButton({
  canAct = true,
  gateReason,
  title,
  disabled,
  className,
  children,
  ...rest
}: GatedButtonProps) {
  const effectivelyDisabled = disabled || !canAct;
  const tooltip = !canAct && gateReason
    ? `Somente leitura — seu perfil não pode ${gateReason}`
    : title;

  return (
    <span
      // `inline-flex` so the span sizes to the button and doesn't
      // collapse to zero width / break inline layouts. `title`
      // here (not on the button) is what makes the tooltip work
      // in Safari / older Firefox — those browsers don't fire
      // mouseover on disabled buttons.
      className={cn("inline-flex", !canAct && "cursor-not-allowed")}
      title={tooltip}
    >
      <Button
        disabled={effectivelyDisabled}
        className={className}
        {...rest}
      >
        {children}
      </Button>
    </span>
  );
}
