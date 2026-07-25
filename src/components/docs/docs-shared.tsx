"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DOC_PAGES } from "@/lib/docs/content";
import {
  docHeading,
  docLinkButton,
  docMuted,
  docNavAside,
  docNavLink,
  docNavLinkActive,
  docNavPanel,
  docNavSectionTitle,
  docNavTocLink,
  docTitle,
} from "@/components/public/public-theme";

export function SectionHeading({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description?: string;
}) {
  return (
    <div id={id} className="scroll-mt-24">
      <h2 className={docHeading}>{title}</h2>
      {description ? <p className={`mt-1 text-sm ${docMuted}`}>{description}</p> : null}
    </div>
  );
}

export function DocLinkButton({
  href,
  label,
  external,
}: {
  href: string;
  label: string;
  external?: boolean;
}) {
  if (external) {
    return (
      <Button
        variant="outline"
        size="sm"
        render={
          <a href={href} target="_blank" rel="noopener noreferrer" />
        }
        className={docLinkButton}
      >
        {label}
        <ExternalLink className="size-3.5" />
      </Button>
    );
  }

  if (href.startsWith("#")) {
    return (
      <Button
        variant="outline"
        size="sm"
        render={<a href={href} />}
        className={docLinkButton}
      >
        {label}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      render={<Link href={href} />}
      className={docLinkButton}
    >
      {label}
      <ArrowRight className="size-3.5" />
    </Button>
  );
}

export function DocsShell({
  title,
  description,
  toc,
  children,
}: {
  title: string;
  description: string;
  toc?: { id: string; title: string }[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className={`text-2xl font-bold ${docTitle}`}>{title}</h1>
        <p className={`mt-1 max-w-2xl text-sm ${docMuted}`}>{description}</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,16.5rem)_minmax(0,1fr)] lg:gap-10">
        <aside className={docNavAside}>
          <div className="space-y-4">
            <div className={docNavPanel}>
              <p className={docNavSectionTitle}>Documentation</p>
              <ul className="space-y-0.5">
                {DOC_PAGES.map((page) => {
                  const active = pathname === page.href;
                  return (
                    <li key={page.href}>
                      <Link
                        href={page.href}
                        className={cn(docNavLink, active && docNavLinkActive)}
                      >
                        {page.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>

            {toc?.length ? (
              <div className={cn(docNavPanel, "hidden lg:block")}>
                <p className={docNavSectionTitle}>On this page</p>
                <ul className="space-y-0.5">
                  {toc.map((section) => (
                    <li key={section.id}>
                      <a href={`#${section.id}`} className={docNavTocLink}>
                        {section.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </aside>

        <div className="min-w-0 space-y-10">{children}</div>
      </div>
    </div>
  );
}

export const TROUBLESHOOTING_ITEMS = [
  {
    issue: "No inbound messages arriving",
    fix: "Verify registered_at is set, webhook URL is correct, messages field subscribed, and App Secret is configured.",
    link: "/whatsapp/config",
    linkLabel: "Open WhatsApp Config",
  },
  {
    issue: "Webhook returns 401",
    fix: "Add your Meta App Secret in Settings → App Secret.",
    link: "/whatsapp/app-secret",
    linkLabel: "Open App Secret",
  },
  {
    issue: "Templates not sending",
    fix: "Template must be APPROVED in Meta. Sync from Meta in Settings → Templates.",
    link: "/whatsapp/templates",
    linkLabel: "Open Templates",
  },
  {
    issue: "Automation wait steps stuck",
    fix: "Wait steps need background processing every minute — see Background Tasks on Getting Started.",
    link: "/docs/getting-started#cron-jobs",
    linkLabel: "Background Tasks",
  },
  {
    issue: "Email marketing shows an upgrade gate",
    fix: "Email marketing is on Business and Enterprise only. Upgrade from Billing, then open Email → SMTP.",
    link: "/billing",
    linkLabel: "Open Billing",
  },
  {
    issue: "SMTP verifies but test email never arrives",
    fix: "Confirm the From address is verified at your provider (exact local-part), check spam, and whitelist this server’s IP if required. See Email Marketing docs.",
    link: "/docs/email-marketing",
    linkLabel: "Email Marketing docs",
  },
  {
    issue: "Team invite link not working",
    fix: "Revoke the old invite and send a new one from Settings → Team. Team invites require Enterprise.",
    link: "/team",
    linkLabel: "Open Team",
  },
] as const;
