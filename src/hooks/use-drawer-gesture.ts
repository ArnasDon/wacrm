"use client";

import { useEffect, useRef } from "react";

// Same activation band as the previous swipe-detector version — a touch
// only starts a candidate "open" drag if it begins this close to the
// left edge, which is what keeps this from ever competing with
// horizontal-scrolling content elsewhere (Pipeline columns, the
// dashboard's weekly agenda): those always start well past this narrow
// band, since real content sits inside the page's own padding.
const EDGE_ZONE_PX = 24;
// Minimum movement in either axis before committing to "this is a
// horizontal drag" vs "this is a vertical scroll" vs "not a gesture at
// all yet". Below this, a shaky touchstart doesn't flip anything.
const DECIDE_AFTER_PX = 8;
// Horizontal movement must beat vertical by this multiple to count as
// a horizontal drag once past DECIDE_AFTER_PX.
const DIRECTION_DOMINANCE = 1.2;
// The exact release rule requested: more than halfway open → finish
// opening; anything else → snap back closed. Same rule mirrored for
// closing (more than halfway closed → finish closing).
const OPEN_PROGRESS_THRESHOLD = 0.5;
// iOS's own native curve for sheets/panels — the "ease-out-native" feel
// the ask specifically asked for ("aceleração natural").
const SETTLE_TRANSFORM_TRANSITION = "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)";
const SETTLE_OPACITY_TRANSITION = "opacity 220ms cubic-bezier(0.32, 0.72, 0, 1)";

interface UseDrawerGestureOptions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Element the touch listeners are attached to — must contain both
   *  the panel and (while closed) the edge-zone area the gesture starts
   *  in. In practice the whole app shell. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** The sliding drawer element itself — its `style.transform` is
   *  driven directly during the gesture, bypassing React, so the panel
   *  tracks the finger at the browser's own frame rate. */
  panelRef: React.RefObject<HTMLElement | null>;
  /** The dark backdrop — its opacity is driven in lockstep with the
   *  panel's open progress. */
  backdropRef: React.RefObject<HTMLElement | null>;
}

interface GestureState {
  mode: "open" | "close";
  startX: number;
  startY: number;
  decided: boolean;
  rejected: boolean;
  width: number;
}

/**
 * Drag-to-open/close for the mobile sidebar drawer, tracking the finger
 * 1:1 during the gesture (no jump to fully-open, no waiting for
 * touchend to show anything) and resolving on release by the exact
 * >50%-open / <50%-open rule. Deliberately bypasses React state for the
 * per-frame updates — `panelRef`/`backdropRef` get their `style.transform`
 * / `style.opacity` written directly in the touchmove handler, which is
 * the standard way to keep a drag-follow interaction smooth in React
 * (a setState per touchmove would re-render on every frame instead of
 * just repainting these two elements).
 *
 * React state (`open`) is only touched once, at the end of the gesture
 * — so the component's own CSS-class-driven styling (used for every
 * *non*-gesture interaction: hamburger button, backdrop click, ESC,
 * route change) stays the single source of truth for the "settled"
 * state, and this hook's inline styles are cleared once its own
 * release animation finishes.
 */
export function useDrawerGesture({
  open,
  onOpenChange,
  containerRef,
  panelRef,
  backdropRef,
}: UseDrawerGestureOptions) {
  const gestureRef = useRef<GestureState | null>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function applyTransform(translateX: number, withTransition: boolean) {
      const panel = panelRef.current;
      if (!panel) return;
      panel.style.transition = withTransition ? SETTLE_TRANSFORM_TRANSITION : "none";
      panel.style.transform = `translate3d(${translateX}px,0,0)`;
    }

    function applyBackdrop(progress: number, withTransition: boolean) {
      const backdrop = backdropRef.current;
      if (!backdrop) return;
      backdrop.style.transition = withTransition ? SETTLE_OPACITY_TRANSITION : "none";
      backdrop.style.opacity = String(progress);
      backdrop.style.pointerEvents = progress > 0.01 ? "auto" : "none";
    }

    // Hands control back to the component's own `open`-driven CSS
    // classes once a gesture (drag or the resulting settle animation)
    // is fully done, so the *next* interaction — of any kind — starts
    // from a clean slate.
    function clearInlineStyles() {
      const panel = panelRef.current;
      const backdrop = backdropRef.current;
      if (panel) {
        panel.style.transform = "";
        panel.style.transition = "";
      }
      if (backdrop) {
        backdrop.style.opacity = "";
        backdrop.style.transition = "";
        backdrop.style.pointerEvents = "";
      }
    }

    function onTouchStart(e: TouchEvent) {
      const touch = e.touches[0];
      const panel = panelRef.current;
      if (!touch || !panel) return;

      if (openRef.current) {
        // Drawer is open — any touch anywhere on it is a close-drag
        // candidate (matches "swipe direita→esquerda em qualquer lugar
        // do menu aberto").
        gestureRef.current = {
          mode: "close",
          startX: touch.clientX,
          startY: touch.clientY,
          decided: false,
          rejected: false,
          width: panel.offsetWidth,
        };
        return;
      }

      // Drawer is closed — only a touch starting in the edge band can
      // open it.
      if (touch.clientX > EDGE_ZONE_PX) return;
      gestureRef.current = {
        mode: "open",
        startX: touch.clientX,
        startY: touch.clientY,
        decided: false,
        rejected: false,
        width: panel.offsetWidth,
      };
    }

    function onTouchMove(e: TouchEvent) {
      const g = gestureRef.current;
      if (!g || g.rejected) return;
      const touch = e.touches[0];
      if (!touch) return;

      const dx = touch.clientX - g.startX;
      const dy = touch.clientY - g.startY;

      if (!g.decided) {
        if (Math.abs(dx) < DECIDE_AFTER_PX && Math.abs(dy) < DECIDE_AFTER_PX) return;
        const isHorizontal = Math.abs(dx) > Math.abs(dy) * DIRECTION_DOMINANCE;
        const rightDirectionForMode = g.mode === "open" ? dx > 0 : dx < 0;
        if (!isHorizontal || !rightDirectionForMode) {
          // Vertical scroll, or dragging the "wrong" way — this was
          // never our gesture. Bail without ever having called
          // preventDefault, so native scrolling is untouched.
          g.rejected = true;
          return;
        }
        g.decided = true;
      }

      // Committed to the drag — stop the page scrolling/bouncing under it.
      e.preventDefault();

      const base = g.mode === "open" ? -g.width : 0;
      const translateX = Math.max(-g.width, Math.min(0, base + dx));
      applyTransform(translateX, false);
      const progress = g.width > 0 ? 1 + translateX / g.width : 0;
      applyBackdrop(progress, false);
    }

    function settle(shouldOpen: boolean, width: number) {
      applyTransform(shouldOpen ? 0 : -width, true);
      applyBackdrop(shouldOpen ? 1 : 0, true);
      if (shouldOpen !== openRef.current) onOpenChange(shouldOpen);
      // Let the 220ms settle transition finish before releasing control
      // back to the CSS classes, otherwise they'd stomp the transform
      // mid-animation.
      window.setTimeout(clearInlineStyles, 260);
    }

    function onTouchEnd(e: TouchEvent) {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (!g || !g.decided || g.rejected) return;

      const width = g.width;
      const touch = e.changedTouches[0];
      const dx = touch ? touch.clientX - g.startX : 0;
      const base = g.mode === "open" ? -width : 0;
      const translateX = Math.max(-width, Math.min(0, base + dx));
      const progress = width > 0 ? 1 + translateX / width : 0;

      settle(progress > OPEN_PROGRESS_THRESHOLD, width);
    }

    function onTouchCancel() {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (!g || !g.decided) return;
      // Interrupted mid-drag (e.g. an incoming call) — snap back to
      // whatever the last settled state was, don't leave it half-open.
      settle(openRef.current, g.width);
    }

    // touchmove is the only listener that ever calls preventDefault, and
    // only once a gesture is confirmed horizontal — so it can't be
    // passive. The rest never block the browser's own handling.
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [containerRef, panelRef, backdropRef, onOpenChange]);
}
