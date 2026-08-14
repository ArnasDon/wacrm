'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export type PullToRefreshPhase = 'idle' | 'pulling' | 'release' | 'refreshing' | 'done';

/** Dispatched on `window` right before the "soft" refresh path
 *  (`router.refresh()`) runs — an opt-in hook for any component that
 *  owns its own client-fetched data (this app has no shared query cache
 *  to invalidate centrally; see the hook's own doc comment) and wants to
 *  re-fetch when the user pulls to refresh. Same ad-hoc
 *  `window.dispatchEvent(new CustomEvent(...))` convention already used
 *  by `use-lead-pipeline-stage.ts`'s `wacrm:deal-stage-changed`. */
export const PULL_TO_REFRESH_EVENT = 'wacrm:pull-to-refresh';

// Same decide-phase convention as use-drawer-gesture.ts: don't commit to
// a gesture until it's moved a little, then require it to be clearly
// vertical (not a horizontal swipe) before taking over from native
// scrolling.
const DECIDE_AFTER_PX = 8;
const DIRECTION_DOMINANCE = 1.5;
// Rubber-band feel: the indicator travels slower than the finger and
// never past MAX_PULL_PX, however far the user keeps pulling.
const PULL_RESISTANCE = 0.55;
const INDICATOR_HEIGHT_PX = 56;
const MAX_PULL_PX = 84;
// Distance (post-resistance) needed before release triggers a refresh.
const REFRESH_THRESHOLD_PX = INDICATOR_HEIGHT_PX;
// However fast the refresh actually resolves, keep the spinner visible
// at least this long — one that completes in 40ms would otherwise just
// flash, which reads as broken rather than instant.
const MIN_REFRESH_VISIBLE_MS = 500;
// How long to wait for a new service worker to take over before giving
// up and falling back to a normal data refresh.
const SW_UPDATE_TIMEOUT_MS = 1500;
const SETTLE_TRANSITION = 'transform 260ms cubic-bezier(0.32, 0.72, 0, 1), opacity 260ms ease-out';

/** "iPhone" alone already excludes Android (UA says "Android") and iPad
 *  (iPadOS 13+ reports as "Macintosh"; older iPadOS says "iPad" — never
 *  "iPhone" either way), so no separate iPad check is needed. Excluding
 *  the other iOS browser shells (Chrome/Firefox/Edge/Opera-on-iOS, which
 *  all inject their own token even though they're WebKit underneath)
 *  keeps this to genuine Safari — "Safari no iPhone" — which covers both
 *  a regular Safari tab and a home-screen PWA (installed *from* Safari,
 *  so it shares the same UA family). */
function isIPhoneSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

// Gestures starting inside any of these never arm pull-to-refresh — they
// own their own vertical drag/scroll. `aria-roledescription` is what
// @dnd-kit stamps on every draggable handle (Pipeline cards, stage
// reordering in Settings); the rest are the generic categories from the
// spec (sliders, text inputs, anything explicitly opted out via
// `data-no-pull-refresh`).
const IGNORE_SELECTOR =
  '[aria-roledescription], [role="slider"], input, textarea, select, [contenteditable="true"], [data-no-pull-refresh]';

function hasOwnScroll(el: Element): boolean {
  if (el.scrollHeight <= el.clientHeight) return false;
  const overflowY = getComputedStyle(el).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll';
}

/** Walks from the touched element up to (not including) `container` —
 *  the app's single real scroll container — bailing out if it crosses
 *  an interactive/draggable element or a *different* scrollable region
 *  (e.g. the Inbox conversation list or message thread, each
 *  `overflow-y-auto` on its own). Modals/sheets never need a check here:
 *  Radix renders them through a Portal, outside `container`'s subtree
 *  entirely, so a touch inside one can never reach this walk. */
function shouldIgnoreGesture(target: EventTarget | null, container: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  let el: Element | null = target;
  while (el && el !== container) {
    if (el.matches(IGNORE_SELECTOR)) return true;
    if (hasOwnScroll(el)) return true;
    el = el.parentElement;
  }
  return false;
}

/** Forces the active service worker registration to check the network
 *  for a new version, and resolves `true` only once a new one has
 *  actually taken control. `public/sw.js` already calls `skipWaiting()`
 *  (on `install`) and `clients.claim()` (on `activate`) unconditionally
 *  — every fetched update self-activates with no "waiting" worker to
 *  nudge — so `registration.update()` plus a one-shot `controllerchange`
 *  listener is the whole story; nothing to `postMessage`. Most sessions
 *  have no registration at all (the service worker only gets registered
 *  when a user turns on push notifications, in
 *  settings/push-notifications-card.tsx) — that's the fast, common
 *  `false` path below. */
async function checkForNewServiceWorker(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (!registration) return false;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    function finish(result: boolean) {
      if (settled) return;
      settled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      resolve(result);
    }
    function onControllerChange() {
      finish(true);
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    registration!.update().catch(() => finish(false));
    window.setTimeout(() => finish(false), SW_UPDATE_TIMEOUT_MS);
  });
}

interface GestureState {
  startX: number;
  startY: number;
  decided: boolean;
  rejected: boolean;
  distance: number;
}

interface UsePullToRefreshOptions {
  /** The indicator element — only its `transform`/`opacity` are ever
   *  touched, and only via direct DOM writes during the gesture (same
   *  reasoning as use-drawer-gesture.ts: a setState per touchmove would
   *  re-render on every frame instead of just repainting this one node).
   *  Deliberately *not* the scroll container itself or its content —
   *  transforming `<main>` would make it a new containing block for any
   *  `position: fixed` descendant (toasts, dropdowns), silently
   *  repositioning them mid-gesture. */
  indicatorRef: React.RefObject<HTMLElement | null>;
}

/**
 * Global pull-to-refresh, iPhone Safari only (regular tab or a
 * home-screen PWA — see `isIPhoneSafari`; a no-op everywhere else,
 * Android/desktop/iPad included, listeners never attached).
 *
 * Refresh has two paths, tried in order:
 * 1. A new service worker is live (see `checkForNewServiceWorker`) →
 *    hard `window.location.reload()`, picking it up.
 * 2. Otherwise, a soft refresh: `router.refresh()` re-runs this route's
 *    Server Component data fetching (the App Router's own built-in
 *    "invalidate and refetch"), plus a `PULL_TO_REFRESH_EVENT` dispatch
 *    for any client-fetched data. There's no react-query/SWR (or any
 *    shared cache) anywhere in this app to invalidate centrally — every
 *    page fetches its own client data ad hoc (`useEffect` + a direct
 *    Supabase call, e.g. calculator-view.tsx's `listCalcProjects`) — so
 *    this event is the most a *generic*, page-agnostic refresh can
 *    honestly promise without inventing a new data layer. No current
 *    page listens for it yet; it's here for any that want to opt in.
 *
 * Returns `containerRef` as a *callback* ref (`(node) => void`), not a
 * plain `RefObject` — deliberately. dashboard-shell.tsx renders `<main>`
 * behind an auth-loading gate (`if (loading) return <spinner/>`), so the
 * very first render of the whole shell happens before `<main>` exists at
 * all; hooks still run unconditionally on that render. A `RefObject`
 * passed in from the caller would read `.current === null` in this
 * hook's one-shot mount effect and never get another chance — mutating
 * `.current` later doesn't trigger a re-render, so nothing would ever
 * re-attach the listeners. A callback ref sidesteps that: React invokes
 * it exactly when `<main>` actually mounts, on whichever render that
 * turns out to be, and storing the node in state here correctly
 * retriggers the setup effect at that point.
 */
export function usePullToRefresh({ indicatorRef }: UsePullToRefreshOptions) {
  const [phase, setPhase] = useState<PullToRefreshPhase>('idle');
  const phaseRef = useRef<PullToRefreshPhase>('idle');
  const gestureRef = useRef<GestureState | null>(null);
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  const [container, setContainer] = useState<HTMLElement | null>(null);
  const containerRef = useCallback((node: HTMLElement | null) => {
    setContainer(node);
  }, []);

  useEffect(() => {
    if (!isIPhoneSafari()) return;
    if (!container) return;
    // `container!` below (inside the touch handlers): TS doesn't carry
    // this guard's narrowing into the nested function declarations that
    // close over `container`, since they're only *called* later (by the
    // listeners registered at the bottom of this effect) — but nothing
    // reassigns this const in between, so the non-null assertion is safe.

    function setPhaseBoth(next: PullToRefreshPhase) {
      phaseRef.current = next;
      setPhase(next);
    }

    function applyIndicator(distance: number, withTransition: boolean) {
      const indicator = indicatorRef.current;
      if (!indicator) return;
      indicator.style.transition = withTransition ? SETTLE_TRANSITION : 'none';
      const translateY = Math.min(0, distance - INDICATOR_HEIGHT_PX);
      indicator.style.transform = `translateY(${translateY}px)`;
      // Tailwind v4's `-translate-y-full` (the resting className below)
      // sets the standalone CSS `translate` property, not `transform` —
      // a *separate* property that composes with `transform` instead of
      // being overridden by it. Left alone, its own -100% would keep
      // fighting every `transform` write above, capping the indicator at
      // "fully hidden" no matter what distance says. Neutralizing it here
      // hands full control to `transform` for the duration of the
      // gesture; `clearInlineStyles` below hands it back at rest.
      indicator.style.translate = '0';
      indicator.style.opacity = String(Math.min(1, distance / REFRESH_THRESHOLD_PX));
    }

    // Hands control back to the indicator's own resting Tailwind classes
    // (`-translate-y-full opacity-0`) once the settle transition is
    // done, same pattern as use-drawer-gesture.ts's `clearInlineStyles`.
    function clearInlineStyles() {
      const indicator = indicatorRef.current;
      if (!indicator) return;
      indicator.style.transform = '';
      indicator.style.translate = '';
      indicator.style.opacity = '';
      indicator.style.transition = '';
    }

    function reset() {
      applyIndicator(0, true);
      window.setTimeout(() => {
        clearInlineStyles();
        setPhaseBoth('idle');
      }, 280);
    }

    function onTouchStart(e: TouchEvent) {
      if (phaseRef.current === 'refreshing') return; // no overlapping refreshes
      const touch = e.touches[0];
      if (!touch) return;
      if (container!.scrollTop > 0) return; // only a pull from the very top counts
      if (shouldIgnoreGesture(e.target, container!)) return;
      gestureRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        decided: false,
        rejected: false,
        distance: 0,
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
        const isDownwardPull = dy > 0 && dy > Math.abs(dx) * DIRECTION_DOMINANCE;
        if (!isDownwardPull || container!.scrollTop > 0) {
          // Horizontal swipe, scrolling up, or already scrolled — never
          // our gesture. Bail without ever calling preventDefault, so
          // native scroll/swipe handling is untouched.
          g.rejected = true;
          return;
        }
        g.decided = true;
      }

      // Committed to the pull — stop native scroll/rubber-band under it.
      e.preventDefault();
      const damped = Math.min(MAX_PULL_PX, dy * PULL_RESISTANCE);
      g.distance = damped;
      applyIndicator(damped, false);
      setPhaseBoth(damped >= REFRESH_THRESHOLD_PX ? 'release' : 'pulling');
    }

    async function onTouchEnd() {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (!g || !g.decided || g.rejected) return;

      if (g.distance < REFRESH_THRESHOLD_PX) {
        reset();
        return;
      }

      setPhaseBoth('refreshing');
      applyIndicator(REFRESH_THRESHOLD_PX, true);

      const startedAt = Date.now();
      try {
        const gotNewServiceWorker = await checkForNewServiceWorker();
        if (gotNewServiceWorker) {
          window.location.reload();
          return;
        }
        window.dispatchEvent(new CustomEvent(PULL_TO_REFRESH_EVENT));
        routerRef.current.refresh();
      } finally {
        const elapsed = Date.now() - startedAt;
        window.setTimeout(() => {
          setPhaseBoth('done');
          reset();
        }, Math.max(0, MIN_REFRESH_VISIBLE_MS - elapsed));
      }
    }

    function onTouchCancel() {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (!g || !g.decided || phaseRef.current === 'refreshing') return;
      reset();
    }

    // touchmove is the only listener that ever calls preventDefault, and
    // only once a gesture is confirmed as a downward pull from the top —
    // so it can't be passive. The rest never block the browser's own
    // handling.
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [container, indicatorRef]);

  return { phase, containerRef };
}
