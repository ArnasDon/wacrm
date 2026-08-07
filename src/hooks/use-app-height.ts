"use client";

import { useEffect } from "react";

function isTextInput(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "TEXTAREA" || el.tagName === "INPUT";
}

/** Sets `--app-height`, the app shell's structural height, only in real
 *  iOS standalone-PWA use — a no-op everywhere else (desktop, a regular
 *  Safari tab), where plain `dvh` already behaves correctly and this
 *  hook doesn't touch anything.
 *
 *  Why this exists (2026-08-07, parte 27): on-device measurements taken
 *  minutes apart, no keyboard involved, showed `window.innerHeight`
 *  (which `dvh` tracks) flip between 932 and 873 on the *same* device —
 *  proof that no static CSS formula built from `dvh` can be correct in
 *  both states, because the "correct" answer genuinely differs between
 *  them. `window.outerHeight`, across every real-device reading taken
 *  in this project's history, has been 932 every single time — the one
 *  stable signal available.
 *
 *  So: rest on `outerHeight` (stable) when nothing needs the keyboard,
 *  and switch to `visualViewport.height` (live, keyboard-aware — this
 *  part was never the problem, `dvh`'s own keyboard-shrink behavior,
 *  parte 14, already worked) the moment a text field is focused.
 *  Critically, *what triggers the switch* is the `focusin`/`focusout`
 *  event, not a threshold on the height number itself — inferring
 *  "is the keyboard open" from the height reading is exactly what
 *  doesn't work here, since that reading is the unreliable part.
 *  Earlier attempts at a JS-driven height (partes 13, 17) failed
 *  because they tried to correct or compensate *after* reading an
 *  ambiguous number; this one sidesteps the ambiguity instead. */
export function useAppHeight() {
  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ?? false;
    if (!standalone) return;

    const root = document.documentElement;

    function setResting() {
      root.style.setProperty("--app-height", `${window.outerHeight}px`);
    }

    function setLive() {
      const h = window.visualViewport?.height ?? window.innerHeight;
      root.style.setProperty("--app-height", `${h}px`);
    }

    function onFocusIn(e: FocusEvent) {
      if (!isTextInput(e.target)) return;
      setLive();
      window.visualViewport?.addEventListener("resize", setLive);
    }

    function onFocusOut(e: FocusEvent) {
      if (!isTextInput(e.target)) return;
      window.visualViewport?.removeEventListener("resize", setLive);
      // A focusout can be immediately followed by a focusin on the next
      // field (tabbing between inputs) — wait a tick so that case
      // doesn't flash back to the resting height mid-transition.
      setTimeout(() => {
        if (!isTextInput(document.activeElement)) {
          setResting();
        }
      }, 50);
    }

    setResting();
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("orientationchange", setResting);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("orientationchange", setResting);
      window.visualViewport?.removeEventListener("resize", setLive);
    };
  }, []);
}
