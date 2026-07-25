import Link from "next/link";
import { Mail, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { vm } from "@/components/marketing/marketing-theme";
import { cn } from "@/lib/utils";

/**
 * Equal spotlight for WhatsApp + Email on marketing / SEO surfaces.
 */
export function ChannelPair({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {!compact ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-700">
            Channels
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            WhatsApp and Email — both first-class
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Run Meta WhatsApp Business messaging and BYO-SMTP email marketing
            from the same CRM workspace. Neither channel is secondary.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <ChannelCard
          icon={Phone}
          title="WhatsApp"
          body="Official Business API inbox, templates, broadcasts, and App Secret setup."
          href="/docs/whatsapp-setup"
          cta="WhatsApp setup"
          accent="whatsapp"
        />
        <ChannelCard
          icon={Mail}
          title="Email"
          body="Bring your SMTP, grow lists, use starter templates, and send campaigns."
          href="/docs/email-marketing"
          cta="Email marketing"
          accent="email"
        />
      </div>
    </div>
  );
}

function ChannelCard({
  icon: Icon,
  title,
  body,
  href,
  cta,
  accent,
}: {
  icon: typeof Phone;
  title: string;
  body: string;
  href: string;
  cta: string;
  accent: "whatsapp" | "email";
}) {
  const iconWrap =
    accent === "whatsapp"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : "bg-sky-50 text-sky-700 ring-sky-100";
  const borderHover =
    accent === "whatsapp"
      ? "hover:border-emerald-300"
      : "hover:border-sky-300";

  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors",
        borderHover,
      )}
    >
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-xl ring-1",
          iconWrap,
        )}
      >
        <Icon className="size-5" />
      </div>
      <h3 className="mt-3 text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{body}</p>
      <div className="mt-4">
        <Button
          variant="outline"
          size="sm"
          className={cn("rounded-lg", vm.btnOutline)}
          render={<Link href={href} />}
        >
          {cta}
        </Button>
      </div>
    </div>
  );
}
