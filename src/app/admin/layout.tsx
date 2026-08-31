import { isPlatformAdmin } from "@/lib/auth/platform-admin";
import { ShieldAlert, Building2, CreditCard, UserPlus, LayoutDashboard } from "lucide-react";
import Link from "next/link";

export const metadata = {
  title: "Platform Admin Console - WACRM",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAdmin = await isPlatformAdmin();

  if (!isAdmin) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-background px-4">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-4">
            <ShieldAlert className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Platform Admin Access Required
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This console is reserved for platform administrators only. If you believe you should have access, please contact the system operator.
          </p>
          <div className="mt-6">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              <LayoutDashboard className="h-4 w-4" />
              Return to CRM Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
              PA
            </div>
            <div>
              <span className="font-semibold text-sm leading-none block">WACRM</span>
              <span className="text-[10px] text-primary font-medium tracking-wide uppercase">
                Platform Admin Console
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            <Link
              href="/admin/accounts"
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              Accounts
            </Link>
            <Link
              href="/admin/billing"
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
              Billing
            </Link>
            <Link
              href="/admin/provisioning"
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
              Provisioning
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            CRM App
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
    </div>
  );
}
