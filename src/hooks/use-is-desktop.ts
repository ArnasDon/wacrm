"use client";

import { useEffect, useState } from "react";

// Tailwind's `lg` breakpoint. Anything narrower is treated as a touch
// phone/tablet where drag-to-reorder is unusable.
const QUERY = "(min-width: 1024px)";

/**
 * `true` on lg+ screens. SSR and the first client render return `true`
 * (desktop is the safe default — it matches the server markup, so no
 * hydration mismatch); the real value lands in an effect on mount and
 * then tracks viewport changes. Callers that render very different
 * trees per breakpoint should gate behind a loading state so the
 * one-frame default swap isn't visible.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return isDesktop;
}
