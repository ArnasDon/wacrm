"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CornerUpLeft } from "lucide-react";
import { cn } from "@/lib/utils";

// How far the bubble can be pulled, how far it must travel to arm the
// reply, and how much of the finger's movement actually translates into
// pull (rubber-band resistance) — tuned to feel like WhatsApp / IG DMs.
const MAX_PULL = 64;
const TRIGGER = 40;
const RESISTANCE = 0.55;
// Movement (px) before we decide the gesture is a horizontal swipe vs a
// vertical scroll. Below this the touch is still ambiguous.
const AXIS_SLOP = 8;

interface SwipeToReplyProps {
  /** Fired once when the bubble is released past the trigger distance. */
  onReply: () => void;
  /**
   * Outbound bubbles sit against the right edge, so they pull LEFT toward
   * the centre (arrow on the right); inbound bubbles pull RIGHT. Keeps
   * the bubble from ever being dragged off either screen edge.
   */
  fromEnd: boolean;
  children: ReactNode;
}

/**
 * Touch-only swipe-to-reply, wrapped around a single message bubble.
 * Drag the bubble toward the centre of the thread; a reply arrow fades
 * in, and releasing past the trigger distance starts a reply to that
 * message (same `onReply` the long-press toolbar calls). On a
 * mouse-only device none of the touch listeners fire, so this is inert.
 */
export function SwipeToReply({ onReply, fromEnd, children }: SwipeToReplyProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);

  // Latest `onReply` without re-subscribing the native listeners every
  // render (the thread passes a fresh closure each time).
  const onReplyRef = useRef(onReply);
  useEffect(() => {
    onReplyRef.current = onReply;
  });

  // `dir` is +1 when the reply pull goes right (inbound), -1 when it
  // goes left (outbound). Stored in a ref so the listener effect can
  // stay mounted across re-renders.
  const dirRef = useRef(fromEnd ? -1 : 1);
  useEffect(() => {
    dirRef.current = fromEnd ? -1 : 1;
  }, [fromEnd]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let axis: "x" | "y" | null = null;
    let tracking = false;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      tracking = true;
      axis = null;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      if (axis === null) {
        if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return;
        axis = Math.abs(dx) > Math.abs(dy) + 4 ? "x" : "y";
      }
      if (axis !== "x") return;

      // Only a pull in the reply direction counts; the other way is a
      // no-op (bubble stays put).
      const travel = dx * dirRef.current;
      const next = travel > 0 ? Math.min(travel * RESISTANCE, MAX_PULL) : 0;
      if (next > 0) e.preventDefault(); // we own this gesture now
      setPull(next);
    };

    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      axis = null;
      setPull((cur) => {
        if (cur >= TRIGGER) {
          onReplyRef.current();
          if ("vibrate" in navigator) {
            try {
              navigator.vibrate(12);
            } catch {
              /* not supported / blocked — no-op */
            }
          }
        }
        return 0;
      });
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const progress = Math.min(pull / TRIGGER, 1);
  const translate = pull * (fromEnd ? -1 : 1);

  return (
    // `touch-action: pan-y` lets the browser keep handling vertical
    // scroll natively while every horizontal gesture comes to us.
    <div ref={rootRef} className="relative" style={{ touchAction: "pan-y" }}>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 flex items-center justify-center",
          fromEnd ? "right-0" : "left-0",
        )}
        style={{
          width: MAX_PULL,
          opacity: progress,
          transform: `scale(${0.5 + progress * 0.5})`,
        }}
      >
        <span className="bg-background/85 text-muted-foreground flex h-8 w-8 items-center justify-center rounded-full shadow-sm">
          <CornerUpLeft className="h-4 w-4" />
        </span>
      </div>
      <div
        style={{
          transform: translate ? `translateX(${translate}px)` : undefined,
          transition: pull === 0 ? "transform 160ms ease-out" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}
