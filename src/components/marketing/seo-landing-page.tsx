import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Sparkles,
  Users,
} from "lucide-react";
import { ChannelPair } from "@/components/marketing/channel-pair";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { vm } from "@/components/marketing/marketing-theme";
import { Button } from "@/components/ui/button";
import {
  COMPANY_NAME,
  PRODUCT_NAME,
  SUPPORT_EMAIL,
} from "@/lib/brand";
import { JsonLd, seoPageJsonLdGraph } from "@/lib/seo/json-ld";
import type { SeoPage } from "@/lib/seo/whatsapp-crm-pages";
import { cn } from "@/lib/utils";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "channels", label: "WhatsApp & Email" },
  { id: "challenges", label: "Challenges" },
  { id: "solution", label: "Solution" },
  { id: "features", label: "Features" },
  { id: "use-cases", label: "Use cases" },
  { id: "how-to-start", label: "How to start" },
  { id: "outcomes", label: "Outcomes" },
  { id: "eeat", label: "Expertise & trust" },
  { id: "faq", label: "FAQ" },
] as const;

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function SeoLandingPageContent({
  page,
  related,
}: {
  page: SeoPage;
  related: SeoPage[];
}) {
  return (
    <MarketingShell theme="light">
      <JsonLd data={seoPageJsonLdGraph(page)} />

      <article className="relative">
        {/* Hero */}
        <header className="relative overflow-hidden border-b border-slate-200/80">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_-15%,rgba(20,184,166,0.14),transparent)]"
          />
          <div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
            <nav
              aria-label="Breadcrumb"
              className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500"
            >
              <Link href="/" className="hover:text-teal-700">
                Home
              </Link>
              <ChevronRight className="size-3.5 opacity-50" />
              <Link href="/whatsapp-crm" className="hover:text-teal-700">
                WhatsApp CRM
              </Link>
              <ChevronRight className="size-3.5 opacity-50" />
              <span className="text-slate-700">{page.industry}</span>
              <ChevronRight className="size-3.5 opacity-50" />
              <span className="font-medium text-slate-900">{page.country}</span>
            </nav>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-700">
                <MapPin className="size-3.5" />
                {page.country}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                <MessageSquare className="size-3.5" />
                {page.industry}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600">
                <BadgeCheck className="size-3.5 text-teal-600" />
                E-E-A-T reviewed
              </span>
            </div>

            <h1 className="mt-5 max-w-3xl text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl sm:leading-[1.1]">
              {page.headline}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-600 sm:text-lg">
              {page.intro}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5 text-teal-600" />
                By {page.authorName}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="size-3.5 text-teal-600" />
                Updated {formatDate(page.dateModified)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <BookOpen className="size-3.5 text-teal-600" />
                Published {formatDate(page.datePublished)}
              </span>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button className={cn("h-11 rounded-xl", vm.btnPrimary)} render={<Link href="/signup" />}>
                Start free
                <ArrowRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                className={cn("h-11 rounded-xl", vm.btnOutline)}
                render={<Link href="/docs/whatsapp-setup" />}
              >
                <Phone className="size-4" />
                WhatsApp setup
              </Button>
              <Button
                variant="outline"
                className={cn("h-11 rounded-xl", vm.btnOutline)}
                render={<Link href="/docs/email-marketing" />}
              >
                <Mail className="size-4" />
                Email marketing
              </Button>
              <Button
                variant="outline"
                className={cn("h-11 rounded-xl", vm.btnOutline)}
                render={<Link href="/pricing" />}
              >
                View pricing
              </Button>
            </div>
          </div>
        </header>

        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12 lg:py-16">
          {/* Sticky TOC */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                On this page
              </p>
              <ul className="mt-3 space-y-1.5">
                {TOC.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="block rounded-lg px-2 py-1.5 text-sm text-slate-600 transition-colors hover:bg-teal-50 hover:text-teal-700"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <div className="min-w-0 space-y-14">
            <section id="overview">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                Overview: WhatsApp + Email CRM for {page.industry} teams in{" "}
                {page.country}
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
                {page.solution}
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  {
                    icon: Phone,
                    label: "WhatsApp",
                    body: "Official Meta Business API",
                  },
                  {
                    icon: Mail,
                    label: "Email",
                    body: "BYO SMTP campaigns (Business+)",
                  },
                  {
                    icon: Lock,
                    label: "Secure credentials",
                    body: "Encrypted token storage",
                  },
                  {
                    icon: Sparkles,
                    label: "Built for teams",
                    body: "Roles, inbox & pipelines",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4"
                  >
                    <item.icon className="size-5 text-teal-600" />
                    <p className="mt-3 text-sm font-semibold text-slate-900">
                      {item.label}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{item.body}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="channels">
              <ChannelPair />
            </section>

            <section id="challenges">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                Challenges for {page.industry} in {page.country}
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
                {page.challenge}
              </p>
            </section>

            <section id="solution">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                How {PRODUCT_NAME} solves it
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
                {page.solution}
              </p>
            </section>

            <section id="features">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                Key features for {page.industry} teams
              </h2>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {page.benefits.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                  >
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 ring-1 ring-teal-100">
                      <CheckCircle2 className="size-3.5" />
                    </span>
                    <span className="leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section id="use-cases">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                High-impact use cases in {page.country}
              </h2>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {page.useCases.map((uc, i) => (
                  <div
                    key={uc.title}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-600">
                      Use case {i + 1}
                    </p>
                    <h3 className="mt-2 text-base font-semibold text-slate-900">
                      {uc.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      {uc.body}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section id="how-to-start">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                How to start in four steps
              </h2>
              <ol className="mt-6 space-y-4">
                {page.steps.map((step, i) => (
                  <li
                    key={step.title}
                    className="flex gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">
                        {step.title}
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                        {step.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section id="outcomes">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                Expected outcomes
              </h2>
              <ul className="mt-5 space-y-2.5">
                {page.outcomes.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2.5 text-sm text-slate-700"
                  >
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section
              id="eeat"
              className="rounded-3xl border border-slate-800/10 bg-gradient-to-br from-slate-900 via-slate-900 to-teal-900 p-6 text-white sm:p-8"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-200">
                Experience · Expertise · Authority · Trust
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                Why this guide is trustworthy
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-slate-300 sm:text-base">
                {page.expertise}
              </p>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {page.trustSignals.map((signal) => (
                  <li
                    key={signal}
                    className="flex items-start gap-2.5 rounded-2xl border border-white/10 bg-white/5 px-3.5 py-3 text-sm text-slate-100"
                  >
                    <BadgeCheck className="mt-0.5 size-4 shrink-0 text-teal-300" />
                    <span>{signal}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-xs text-slate-400">
                Editorial owner: {COMPANY_NAME} · Contact{" "}
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="text-teal-300 hover:underline"
                >
                  {SUPPORT_EMAIL}
                </a>
              </p>
            </section>

            <section id="faq">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                Frequently asked questions
              </h2>
              <dl className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
                {page.faqs.map((faq) => (
                  <div key={faq.q} className="px-5 py-5 sm:px-6">
                    <dt className="text-base font-semibold text-slate-900">
                      {faq.q}
                    </dt>
                    <dd className="mt-2 text-sm leading-relaxed text-slate-600">
                      {faq.a}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="rounded-3xl border border-teal-200 bg-teal-50/60 px-6 py-8 text-center sm:px-10">
              <h2 className="text-xl font-semibold text-slate-900 sm:text-2xl">
                Ready for WhatsApp and Email in {page.country}?
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-slate-600">
                Create your {PRODUCT_NAME} workspace, connect WhatsApp Business
                API and SMTP email, then launch a shared inbox for{" "}
                {page.industry}.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button
                  className={cn("h-11 rounded-xl", vm.btnPrimary)}
                  render={<Link href="/signup" />}
                >
                  Create account
                  <ArrowRight className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  className={cn("h-11 rounded-xl", vm.btnOutline)}
                  render={<Link href="/docs/whatsapp-setup" />}
                >
                  <Phone className="size-4" />
                  WhatsApp
                </Button>
                <Button
                  variant="outline"
                  className={cn("h-11 rounded-xl", vm.btnOutline)}
                  render={<Link href="/docs/email-marketing" />}
                >
                  <Mail className="size-4" />
                  Email
                </Button>
              </div>
            </section>

            {related.length > 0 ? (
              <section className="border-t border-slate-200 pt-10">
                <h2 className="text-xl font-semibold text-slate-900">
                  Related WhatsApp CRM guides
                </h2>
                <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {related.map((item) => (
                    <li key={item.path}>
                      <Link
                        href={item.path}
                        className="block h-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm transition-all hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md"
                      >
                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-700">
                          {item.country}
                        </span>
                        <span className="mt-1 block font-medium text-slate-900">
                          {item.industry}
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          WhatsApp CRM guide
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </article>
    </MarketingShell>
  );
}
