"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_SIDEBAR_STATE,
  SIDEBAR_STORAGE_KEY,
  isSidebarState,
} from "@/lib/sidebar";

// Matches Tailwind's `lg`, which is what every `rail:` style in the
// sidebar is gated on. Below it the sidebar is an off-canvas drawer
// and the collapse preference must not apply.
const DESKTOP_QUERY = "(min-width: 64rem)";

// `<html data-sidebar-state>` is the single source of truth — the boot
// script in src/app/[locale]/layout.tsx writes it from localStorage
// before first paint, so the rail width never flashes. React reads it
// through the store below rather than keeping a parallel copy, which
// also keeps hydration honest: `getServerSnapshot` returns the same
// default the server rendered, and React re-reads the DOM right after.
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function onExternalStorage(e: StorageEvent) {
  // Collapse in one tab, catch up in the others — the same treatment
  // the theme preference gets.
  if (e.key !== SIDEBAR_STORAGE_KEY || !isSidebarState(e.newValue)) return;
  document.documentElement.dataset.sidebarState = e.newValue;
  emit();
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  if (listeners.size === 1) {
    window.addEventListener("storage", onExternalStorage);
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onExternalStorage);
    }
  };
}

function getSnapshot(): boolean {
  return document.documentElement.dataset.sidebarState === "collapsed";
}

function getServerSnapshot(): boolean {
  return DEFAULT_SIDEBAR_STATE === "collapsed";
}

let desktopQuery: MediaQueryList | null = null;

function getDesktopQuery(): MediaQueryList {
  desktopQuery ??= window.matchMedia(DESKTOP_QUERY);
  return desktopQuery;
}

function subscribeDesktop(onStoreChange: () => void) {
  const mq = getDesktopQuery();
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getDesktopSnapshot(): boolean {
  return getDesktopQuery().matches;
}

function getDesktopServerSnapshot(): boolean {
  return false;
}

interface SidebarCollapsedValue {
  /**
   * True only when the sidebar is *actually* a rail right now: the
   * user collapsed it AND the viewport is desktop-width. Use it for
   * what CSS can't express — the toggle's icon and aria state, and the
   * tooltips that stand in for the hidden nav labels.
   */
  collapsed: boolean;
  /** Flips the stored preference (and with it the rail). */
  toggleCollapsed: () => void;
}

/** Desktop sidebar collapse state, persisted per device. */
export function useSidebarCollapsed(): SidebarCollapsedValue {
  const preference = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const isDesktop = useSyncExternalStore(
    subscribeDesktop,
    getDesktopSnapshot,
    getDesktopServerSnapshot,
  );

  const toggleCollapsed = useCallback(() => {
    const state = preference ? "expanded" : "collapsed";
    document.documentElement.dataset.sidebarState = state;
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, state);
    } catch {
      // localStorage can throw in private-browsing / sandboxed
      // contexts; the DOM attribute still updates so the current tab
      // behaves for the session.
    }
    emit();
  }, [preference]);

  return { collapsed: preference && isDesktop, toggleCollapsed };
}
