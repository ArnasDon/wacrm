import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import "../globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import { ErrorBoundary } from "@/components/error-boundary";
import { routing } from "@/i18n/routing";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  MODES,
  STORAGE_KEY,
  THEME_IDS,
} from "@/lib/themes";
import {
  DEFAULT_SIDEBAR_STATE,
  SIDEBAR_STATES,
  SIDEBAR_STORAGE_KEY,
} from "@/lib/sidebar";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "almaCRM",
    template: "%s — almaCRM",
  },
  description: "Self-hostable CRM template for WhatsApp.",
  robots: {
    index: false,
    follow: false,
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
};

// Inline boot script — runs before React hydrates so the user's
// chosen accent (data-theme), mode (data-mode) AND sidebar width
// (data-sidebar-state) are on the <html> element before first paint.
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

    var SIDEBAR_KEY = ${JSON.stringify(SIDEBAR_STORAGE_KEY)};
    var SIDEBAR_DEFAULT = ${JSON.stringify(DEFAULT_SIDEBAR_STATE)};
    var SIDEBARS = ${JSON.stringify(SIDEBAR_STATES)};
    var savedSidebar = localStorage.getItem(SIDEBAR_KEY);
    d.dataset.sidebarState =
      SIDEBARS.indexOf(savedSidebar) !== -1 ? savedSidebar : SIDEBAR_DEFAULT;
  } catch (_e) {
    d.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    d.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
    d.dataset.sidebarState = ${JSON.stringify(DEFAULT_SIDEBAR_STATE)};
  }
})();
`;

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  // Validate that the incoming locale is valid
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html
      lang={locale}
      data-theme={DEFAULT_THEME}
      data-mode={DEFAULT_MODE}
      data-sidebar-state={DEFAULT_SIDEBAR_STATE}
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <div translate="no">
          <NextIntlClientProvider locale={locale} messages={messages}>
            <ThemeProvider>
              <ErrorBoundary>{children}</ErrorBoundary>
              <ThemedToaster />
            </ThemeProvider>
          </NextIntlClientProvider>
        </div>
      </body>
    </html>
  );
}
