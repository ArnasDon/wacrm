import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { Toaster } from "sonner";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import {
  ACCENT_STORAGE_KEY,
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_IDS,
  MODE_STORAGE_KEY,
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
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "dark",
};

// Inline boot script — runs before React hydrates so the user's
// chosen theme is on the <html> element before first paint. Without
// this every page load flashes the default Violet for a frame before
// the React tree mounts and applies the picked theme.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid theme IDs
// is sourced from the THEME_IDS constant so adding a theme doesn't
// silently break the boot path.
const THEME_BOOT_SCRIPT = `
(function(){
  try {
    var STORAGE_KEY = ${JSON.stringify(STORAGE_KEY)};
    var DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var ALLOWED = ${JSON.stringify(THEME_IDS)};
    var saved = localStorage.getItem(STORAGE_KEY);
    var theme = ALLOWED.indexOf(saved) !== -1 ? saved : DEFAULT;
    document.documentElement.dataset.theme = theme;

    var MODE_KEY = ${JSON.stringify(MODE_STORAGE_KEY)};
    var MODES = ${JSON.stringify(MODE_IDS)};
    var savedMode = localStorage.getItem(MODE_KEY);
    document.documentElement.dataset.mode =
      MODES.indexOf(savedMode) !== -1 ? savedMode : ${JSON.stringify(DEFAULT_MODE)};

    // A custom accent is a handful of inline custom properties. Applied
    // here too, otherwise the first paint uses the preset's colour and
    // the page visibly repaints once React mounts.
    var accent = localStorage.getItem(${JSON.stringify(ACCENT_STORAGE_KEY)});
    if (accent && /^#[0-9a-f]{6}$/i.test(accent)) {
      var root = document.documentElement;
      var lum = ['0x' + accent.slice(1, 3), '0x' + accent.slice(3, 5), '0x' + accent.slice(5, 7)]
        .map(function (c, i) {
          var v = Number(c) / 255;
          v = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
          return v * [0.2126, 0.7152, 0.0722][i];
        })
        .reduce(function (a, b) { return a + b; }, 0);
      root.style.setProperty('--primary', accent);
      root.style.setProperty('--primary-foreground', lum > 0.45 ? '#0f172a' : '#ffffff');
      root.style.setProperty('--primary-hover', 'color-mix(in srgb, ' + accent + ' 82%, white)');
      root.style.setProperty('--primary-soft', 'color-mix(in srgb, ' + accent + ' 14%, transparent)');
      root.style.setProperty('--primary-soft-2', 'color-mix(in srgb, ' + accent + ' 24%, transparent)');
      root.style.setProperty('--ring', accent);
      root.style.setProperty('--sidebar-primary', accent);
      root.style.setProperty('--chart-1', accent);
    }
  } catch (_e) {
    document.documentElement.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    document.documentElement.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // The boot script rewrites data-mode and the accent custom
      // properties before React hydrates, so the server HTML is
      // expected to differ here.
      suppressHydrationWarning
      data-theme={DEFAULT_THEME}
      data-mode={DEFAULT_MODE}
      className={`${inter.variable} h-full antialiased`}
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <ThemeProvider>
          {children}
          <Toaster
            theme="dark"
            position="top-right"
            toastOptions={{
              style: {
                background: "rgb(30 41 59)",
                border: "1px solid rgb(51 65 85)",
                color: "white",
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
