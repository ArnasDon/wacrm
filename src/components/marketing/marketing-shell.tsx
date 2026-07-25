import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { VedMintSuiteMenu } from "@/components/marketing/vedmint-suite-menu";
import { cn } from "@/lib/utils";
import {
  COPYRIGHT_NOTICE,
  OFFICIAL_APP_URL,
  PRODUCT_NAME,
  VEDMINT_SUITE,
} from "@/lib/brand";
import { vm } from "@/components/marketing/marketing-theme";

const NAV_LINKS = [
  { href: "/#about", label: "About" },
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/whatsapp-crm", label: "Guides" },
  { href: "/discover", label: "Discover All" },
  { href: "/docs/getting-started", label: "Docs" },
] as const;

type MarketingTheme = "light" | "dark";

export function MarketingShell({
  children,
  theme = "light",
}: {
  children: React.ReactNode;
  theme?: MarketingTheme;
}) {
  const isLight = theme === "light";

  return (
    <div
      className={cn(
        "marketing-light relative min-h-screen",
        isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100",
      )}
    >
      {!isLight ? (
        <>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.15),transparent)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(139,92,246,0.06),transparent_50%)]" />
        </>
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_40%_at_50%_-10%,rgba(20,184,166,0.08),transparent)]" />
      )}

      <header
        className={cn(
          "sticky top-0 z-50 backdrop-blur-md",
          isLight
            ? "border-b border-slate-200/80 bg-white/90"
            : "border-b border-slate-800/80 bg-slate-950/90",
        )}
      >
        <div className="mx-auto flex min-h-[4.75rem] max-w-6xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <Link href="/" className="inline-flex shrink-0 items-center">
            <Logo variant="header" />
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm transition-colors",
                  isLight
                    ? "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-white",
                )}
              >
                {link.label}
              </Link>
            ))}
            <VedMintSuiteMenu isLight={isLight} />
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/login" />}
              className={cn("hidden sm:inline-flex", vm.btnOutline)}
            >
              Log in
            </Button>
            <Button
              size="sm"
              render={<Link href="/signup" />}
              className={vm.btnPrimary}
            >
              Get started
            </Button>
          </div>
        </div>

        <nav
          className={cn(
            "flex gap-1 overflow-x-auto px-4 py-2 md:hidden",
            isLight ? "border-t border-slate-200/80" : "border-t border-slate-800/60",
          )}
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors",
                isLight
                  ? "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:text-slate-900"
                  : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-white",
              )}
            >
              {link.label}
            </Link>
          ))}
          <VedMintSuiteMenu isLight={isLight} compact />
        </nav>
      </header>

      <main className="relative z-10">{children}</main>

      <footer
        className={cn(
          "relative z-10 border-t",
          isLight
            ? "border-slate-200 bg-slate-50"
            : "border-slate-800 bg-slate-950/80",
        )}
      >
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <Link href="/" className="inline-flex items-center">
                <Logo variant="header" />
              </Link>
              <p
                className={cn(
                  "mt-4 max-w-xs text-sm leading-relaxed",
                  isLight ? "text-slate-600" : "text-slate-500",
                )}
              >
                {PRODUCT_NAME} — WhatsApp & Email CRM by VedMint Consultancy
                Services. Part of the VedMint Suite.
              </p>
            </div>

            <div>
              <p
                className={cn(
                  "text-xs font-semibold uppercase tracking-wider",
                  isLight ? "text-slate-500" : "text-slate-500",
                )}
              >
                Product
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {[
                  { href: "/pricing", label: "Pricing & plans" },
                  { href: "/whatsapp-crm", label: "WhatsApp CRM guides" },
                  { href: "/discover", label: "Discover all features" },
                  { href: "/docs/email-marketing", label: "Email marketing docs" },
                  { href: "/docs/getting-started", label: "Documentation" },
                  { href: "/login", label: "Sign in" },
                  { href: "/signup", label: "Create account" },
                ].map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "transition-colors hover:text-teal-600",
                        isLight ? "text-slate-600" : "text-slate-400",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                VedMint Suite
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {VEDMINT_SUITE.map((item) => (
                  <li key={item.id}>
                    {item.external ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "transition-colors hover:text-teal-600",
                          isLight ? "text-slate-600" : "text-slate-400",
                        )}
                      >
                        {item.name}
                      </a>
                    ) : (
                      <Link
                        href="/"
                        className={cn(
                          "transition-colors hover:text-teal-600",
                          isLight ? "text-slate-600" : "text-slate-400",
                        )}
                      >
                        {item.name}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                App
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                <li>
                  <span className="font-mono text-slate-500">
                    {OFFICIAL_APP_URL.replace("https://", "")}
                  </span>
                </li>
                <li>
                  <a
                    href="mailto:support@vedmint.com"
                    className={cn(
                      "transition-colors hover:text-primary",
                      isLight ? "text-slate-600" : "text-slate-400",
                    )}
                  >
                    support@vedmint.com
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <p
            className={cn(
              "mt-10 border-t pt-8 text-center text-xs",
              isLight
                ? "border-slate-200 text-slate-500"
                : "border-slate-800 text-slate-600",
            )}
          >
            {COPYRIGHT_NOTICE}
          </p>
        </div>
      </footer>
    </div>
  );
}
