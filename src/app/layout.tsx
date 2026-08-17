import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  MODES,
  STORAGE_KEY,
  THEME_IDS,
} from "@/lib/themes";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "wacrm",
    template: "%s — wacrm",
  },
  description: "Self-hostable CRM template for WhatsApp.",
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: [{ url: "/icon" }],
    apple: [{ url: "/apple-icon" }],
  },
  // Makes "Add to Home Screen" on iOS Safari launch in standalone mode
  // (no browser chrome) instead of opening as a plain bookmark tab —
  // required for the PWA + Web Push notification flow to feel like an app.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "wacrm",
  },
  // Next's `appleWebApp.capable` only emits the newer, generic
  // `mobile-web-app-capable` tag (confirmed by inspecting the built
  // HTML) — it does *not* also emit the iOS-specific
  // `apple-mobile-web-app-capable` one, even though every other
  // `appleWebApp` field (title, statusBarStyle) does render its
  // iOS-specific tag correctly. Older/some current iOS versions still
  // key standalone-mode detection specifically off the `apple-`
  // prefixed tag, not (only) the generic one, so add it explicitly.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "dark light",
  // Lets the page draw under the iOS home-indicator / Android gesture
  // bar instead of leaving a blank system-colored strip there — required
  // for `env(safe-area-inset-*)` to report a real value at all; without
  // it iOS always reports 0 and safe-area padding (e.g. on the inbox
  // composer) has no effect.
  viewportFit: "cover",
  // App-wide no-zoom: locks the page at 1x and tells the browser not to
  // offer pinch/double-tap zoom at all. Alone this isn't fully reliable
  // on iOS Safari/PWA (WebKit ignores it for pinch on some versions,
  // for accessibility reasons) — the gesture-event listeners in
  // NO_ZOOM_BOOT_SCRIPT below are the actual enforcement; this is the
  // first line of defense and what covers everywhere else (Android
  // Chrome, desktop).
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// Inline boot script — runs before React hydrates so the user's
// chosen accent (data-theme) AND mode (data-mode) are on the <html>
// element before first paint. Without this every page load flashes
// the server-rendered defaults for a frame before the React tree
// mounts and applies the picked values.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid ids is
// sourced from the THEME_IDS / MODES constants so adding one doesn't
// silently break the boot path.
const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  try {
    var THEME_KEY = ${JSON.stringify(STORAGE_KEY)};
    var THEME_DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var THEMES = ${JSON.stringify(THEME_IDS)};
    var savedTheme = localStorage.getItem(THEME_KEY);
    d.dataset.theme = THEMES.indexOf(savedTheme) !== -1 ? savedTheme : THEME_DEFAULT;

    var MODE_KEY = ${JSON.stringify(MODE_STORAGE_KEY)};
    var MODE_DEFAULT = ${JSON.stringify(DEFAULT_MODE)};
    var MODES = ${JSON.stringify(MODES)};
    var savedMode = localStorage.getItem(MODE_KEY);
    d.dataset.mode = MODES.indexOf(savedMode) !== -1 ? savedMode : MODE_DEFAULT;
  } catch (_e) {
    d.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    d.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
  }
})();
`;

// Inline boot script — sets `--app-height` synchronously before first
// paint, same rationale as the theme script above (avoids a flash/
// reflow once the `useAppHeight` hook mounts and would otherwise set
// it for the first time). Only acts in real standalone-PWA use — see
// `use-app-height.ts` for the full reasoning (parte 27) behind using
// `outerHeight` as the resting value there. A no-op everywhere else
// (desktop, a regular Safari tab): the CSS fallback `var(--app-height,
// 100dvh)` covers that case, unchanged from before.
const VIEWPORT_BOOT_SCRIPT = `
(function(){
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      document.documentElement.style.setProperty('--app-height', window.outerHeight + 'px');
    }
  } catch (_e) {}
})();
`;

// App-wide zoom lock. The `viewport` export above (maximumScale: 1,
// userScalable: false) is necessary but not sufficient on iOS Safari/
// PWA — WebKit has ignored viewport-meta zoom limits for pinch since
// iOS 10 (an accessibility carve-out that applies regardless of what
// the page asks for), so pinch and double-tap zoom both still need to
// be blocked at the gesture-event level. Attached once here, before
// hydration, on `document` — global for every route, no per-page
// wiring. `{ passive: false }` is required on both touch listeners:
// browsers default touch listeners to passive, which silently no-ops
// preventDefault() otherwise. Only ever preventDefaults on a 2+-finger
// touchmove or a same-spot-in-time double tap, so normal one-finger
// scrolling and single taps/clicks are untouched.
const NO_ZOOM_BOOT_SCRIPT = `
(function(){
  try {
    // Pinch-to-zoom — WebKit's own multi-touch gesture events (iOS
    // Safari/PWA) ...
    document.addEventListener('gesturestart', function(e) { e.preventDefault(); });
    document.addEventListener('gesturechange', function(e) { e.preventDefault(); });
    document.addEventListener('gestureend', function(e) { e.preventDefault(); });
    // ...plus a touchmove fallback for engines that never fire
    // gesturestart at all (e.g. Android Chrome).
    document.addEventListener('touchmove', function(e) {
      if (e.touches && e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    // Double-tap-to-zoom — two touchend events landing within 300ms of
    // each other. A single tap (and the click it produces) is never
    // touched, only the second tap of a fast double-tap.
    var lastTouchEnd = 0;
    document.addEventListener('touchend', function(e) {
      var now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    }, { passive: false });
  } catch (_e) {}
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      data-theme={DEFAULT_THEME}
      data-mode={DEFAULT_MODE}
      className={`${inter.variable} h-full antialiased`}
      // The `theme-boot` script below rewrites `data-theme` and
      // `data-mode` on <html> from localStorage before React hydrates,
      // so for any non-default choice the client DOM intentionally
      // differs from the server-rendered defaults. suppressHydration-
      // Warning silences the expected mismatch — it only applies to
      // this element's own attributes, so genuine mismatches in
      // children still surface.
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
        <Script
          id="viewport-height-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: VIEWPORT_BOOT_SCRIPT }}
        />
        <Script
          id="no-zoom-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: NO_ZOOM_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider>
            {children}
            <ThemedToaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
