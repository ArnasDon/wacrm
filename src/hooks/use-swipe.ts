"use client";

import { useCallback, useRef } from "react";

// Tuned for a deliberate one-finger swipe, not a flick or a scroll that
// happens to drift sideways. Evaluated once on touchend (not live during
// the drag) — simpler, cheaper (no per-frame re-renders), and more
// robust against jitter: a gesture that reverses mid-drag just nets out
// to "too small" or "wrong direction" instead of needing explicit
// cancellation logic.
const SWIPE_THRESHOLD_PX = 60;
// Horizontal movement must beat vertical by this multiple before we
// treat it as a horizontal swipe at all — rejects diagonal drags and,
// combined with never calling preventDefault, means a vertical scroll
// is never fought or misidentified as a swipe.
const DIRECTION_DOMINANCE = 1.5;

interface UseSwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /**
   * When set, a touch only starts tracking if it begins within this many
   * pixels of the left edge of the touched element. Used for the
   * sidebar's "open" gesture so it can never compete with horizontal-
   * scrolling content elsewhere on the page (Pipeline board columns,
   * the dashboard's weekly agenda, dnd-kit drag handles) — those always
   * start well past a narrow edge band, since real content sits inside
   * the page's own padding.
   */
  edgeZonePx?: number;
}

/**
 * Bare touchstart/touchend swipe detector. Returns plain DOM event
 * handlers to spread onto whichever element should own the gesture —
 * no ref forwarding, no wrapper element, so it composes with any
 * existing className/other handlers on that node.
 */
export function useSwipe({
  onSwipeLeft,
  onSwipeRight,
  edgeZonePx,
}: UseSwipeOptions) {
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      if (edgeZonePx != null && touch.clientX > edgeZonePx) {
        startRef.current = null;
        return;
      }
      startRef.current = { x: touch.clientX, y: touch.clientY };
    },
    [edgeZonePx],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = startRef.current;
      startRef.current = null;
      if (!start) return;
      const touch = e.changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;

      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
      if (Math.abs(dx) <= Math.abs(dy) * DIRECTION_DOMINANCE) return;

      if (dx > 0) onSwipeRight?.();
      else onSwipeLeft?.();
    },
    [onSwipeLeft, onSwipeRight],
  );

  const onTouchCancel = useCallback(() => {
    startRef.current = null;
  }, []);

  return { onTouchStart, onTouchEnd, onTouchCancel };
}
