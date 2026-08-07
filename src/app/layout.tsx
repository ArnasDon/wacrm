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

// Inline boot script — sets `--app-height` (the pixel height JS actually
// sees) synchronously before first paint, same rationale as the theme
// script above. This exists because `100dvh` alone was suspected (2026-08-07
// report, parte 13) of under-reporting the true usable height in real
// iOS standalone-PWA use, leaving a gap at the bottom sized like Safari's
// own chrome — which should never be present in true standalone mode.
// `visualViewport.height` is the most trustworthy read of "space actually
// available for content" on iOS (it's what the on-screen keyboard resizes),
// falling back to `innerHeight` where `visualViewport` doesn't exist.
//
// Deliberately synchronous and pre-paint, unlike the earlier `useEffect`-
// based `--app-height` attempt (removed — see dashboard-shell.tsx) that
// ran *after* first paint and caused a visible reflow: this one lands
// before React even hydrates, so there is exactly one height calculation,
// not two competing ones. `useAppHeight()` (use-app-height.ts) only
// *updates* this value post-mount, for keyboard/rotation changes.
const VIEWPORT_BOOT_SCRIPT = `
(function(){
  try {
    var h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    document.documentElement.style.setProperty('--app-height', h + 'px');
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
