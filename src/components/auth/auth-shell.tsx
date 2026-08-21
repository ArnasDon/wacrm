import type { ReactNode } from 'react';

// Shared pill-shaped field/button treatment for every login-family
// screen — one constant so the three pages can't drift from each
// other. Merged onto each component's own base classes via `cn`
// (tailwind-merge), so these win over the base `rounded-lg`/`h-8`.
export const AUTH_INPUT_CLASS =
  'h-11 rounded-full border-border bg-muted px-4 text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20';
export const AUTH_BUTTON_CLASS =
  'h-11 w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50';

/**
 * Shared visual shell for /login, /signup, and /painel-a17c94fe2b6d/login
 * — centered, no heavy-bordered card, a subtle glow behind the title.
 * Purely presentational; each page keeps its own form state/handlers
 * and just renders them as `children`.
 */
export function AuthShell({
  icon,
  title,
  description,
  children,
  footer,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* Decorative glow behind the title. aria-hidden — carries no content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px] dark:bg-primary/25"
      />
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center">
        {icon ? (
          <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {icon}
          </div>
        ) : null}
        <h1 className="text-center text-[28px] leading-tight font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-[32ch] text-center text-sm text-muted-foreground">{description}</p>
        ) : null}
        <div className="mt-8 w-full">{children}</div>
        {footer ? (
          <div className="mt-6 w-full text-center text-xs text-muted-foreground [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:text-foreground">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
