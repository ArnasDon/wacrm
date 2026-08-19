"use client";

import { useLayoutEffect, useRef } from "react";

const FLIP_VARS = ["--flip-x", "--flip-y", "--flip-scale-x", "--flip-scale-y"] as const;

export interface UseFlipTransitionOptions {
  /** The clicked element's own bounding box, captured synchronously at
   *  click time (`e.currentTarget.getBoundingClientRect()`) — the FLIP
   *  animation's "first" state. Null/undefined (e.g. keyboard
   *  activation landing before layout settles) just falls back to the
   *  popup fading/growing in from its own resting position — still
   *  animated, never a jump to garbage values. */
  originRect?: DOMRect | null;
}

/**
 * Drives the "card grows into its detail view" shared-element open
 * animation used by every card → detail popup in the app (pair with
 * `.flip-modal-popup` / `@keyframes flip-modal-in/out` in globals.css,
 * or `<ExpandingDialogContent>`). Returns a ref to attach to the popup
 * element.
 *
 * Applies the FLIP delta (measured via `getBoundingClientRect`, written
 * as CSS custom properties the keyframes read via `var()`) exactly once
 * per genuine DOM mount of the popup — guarded by DOM NODE IDENTITY,
 * not by a "key"/id prop or a callback ref.
 *
 * Why this matters: an inline callback ref (`ref={(node) => {...}}`) is
 * a brand-new function on every render, and React detaches + reattaches
 * a callback ref whenever its identity changes — i.e. on EVERY re-render
 * of the owning component, not just on mount. The first implementation
 * of this pattern used a callback ref guarded by an id comparison
 * (`lastAppliedId.current !== item.id`), but the detach call itself
 * reset that guard to `null` right before the reattach call re-checked
 * it — so the guard never actually held, and any state update landing
 * while the CSS animation was still in flight (an async fetch
 * resolving, a sibling toggling) re-ran the expensive
 * `getBoundingClientRect()` read and re-wrote the SAME custom
 * properties the already-running animation was reading via `var()`,
 * snapping its in-progress interpolation to a new target — the
 * "frame-by-frame"/jump/stutter symptom this hook exists to fix.
 *
 * A plain object ref (`useRef`) sidesteps the whole bug class: React
 * only ever gives this hook a genuinely new node on an actual (re)mount
 * — first open, a different item's popup, or the same item's popup
 * being torn down and rebuilt (e.g. a "Editar" detour that closes this
 * dialog and reopens it) — and nulls the ref out on unmount, so
 * `appliedNodeRef.current === ref.current` is a correct, self-contained
 * "have I already measured this exact popup instance" check with no
 * separate id to keep in sync with the popup's real mount lifecycle.
 */
export function useFlipTransition({ originRect }: UseFlipTransitionOptions) {
  const ref = useRef<HTMLDivElement | null>(null);
  const appliedNodeRef = useRef<HTMLDivElement | null>(null);

  // No dependency array on purpose — this must re-check after every
  // render (an async fetch resolving elsewhere in the owning component
  // is exactly the case that has to be a no-op here), but the guard
  // below makes every one of those re-checks after the first a single
  // reference comparison, not a re-measurement.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || appliedNodeRef.current === node) return;
    appliedNodeRef.current = node;

    if (!originRect) {
      FLIP_VARS.forEach((v) => node.style.removeProperty(v));
      return;
    }
    const finalRect = node.getBoundingClientRect();
    if (finalRect.width === 0 || finalRect.height === 0) return;
    const dx = originRect.left + originRect.width / 2 - (finalRect.left + finalRect.width / 2);
    const dy = originRect.top + originRect.height / 2 - (finalRect.top + finalRect.height / 2);
    node.style.setProperty("--flip-x", `${dx}px`);
    node.style.setProperty("--flip-y", `${dy}px`);
    node.style.setProperty("--flip-scale-x", String(originRect.width / finalRect.width));
    node.style.setProperty("--flip-scale-y", String(originRect.height / finalRect.height));
  });

  return ref;
}
