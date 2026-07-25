import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  CheckCircle2,
  ExternalLink,
  Globe,
  Headphones,
  Mail,
  MessageSquare,
  Phone,
  Radio,
  Shield,
  Sparkles,
  Target,
  Users,
  Zap,
} from "lucide-react";
import { ChannelPair } from "@/components/marketing/channel-pair";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { FeatureIcon } from "@/components/marketing/feature-icons";
import { vm } from "@/components/marketing/marketing-theme";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  COMPANY_NAME,
  META_DESCRIPTION,
  OFFICIAL_APP_URL,
  PRODUCT_NAME,
  VEDMINT_ECOSYSTEM,
} from "@/lib/brand";
import {
  DASHBOARD_FEATURES,
  DOC_PAGES,
  IMPLEMENTATION_STEPS,
  ROLE_MATRIX,
} from "@/lib/docs/content";

const HIGHLIGHT_FEATURES = DASHBOARD_FEATURES.filter((f) =>
  [
    "inbox",
    "contacts",
    "pipelines",
    "broadcasts",
    "email-marketing",
    "automations",
    "flows",
  ].includes(f.id),
);

const HERO_STATS = [
  { value: "10+", label: "Dashboard modules" },
  { value: "Meta", label: "Official WhatsApp API" },
  { value: "Email", label: "BYO SMTP campaigns" },
  { value: "24/7", label: "Automation & flows" },
] as const;

const HERO_HIGHLIGHTS = [
  "Shared team inbox on one business number",
  "CRM contacts, tags & CSV import",
  "Drag-and-drop sales pipelines",
  "WhatsApp template broadcasts with read tracking",
  "Email marketing with SMTP, lists & starter templates",
  "No-code automations & conversation flows",
] as const;

const USE_CASES = [
  {
    icon: Target,
    title: "Sales teams",
    description:
      "Capture leads from WhatsApp, assign conversations, move deals through pipelines, and automate follow-ups without leaving the inbox.",
    color: "bg-teal-50 text-teal-700",
  },
  {
    icon: Headphones,
    title: "Customer support",
    description:
      "Handle support tickets in a shared inbox with assignment filters, status tracking, templates, and team collaboration on every thread.",
    color: "bg-slate-100 text-slate-800",
  },
  {
    icon: Radio,
    title: "Marketing & outreach",
    description:
      "Send approved Meta WhatsApp template broadcasts and run email campaigns over your own SMTP — lists, starter templates, CSV import, and unsubscribe-ready sends.",
    color: "bg-teal-50 text-teal-600",
  },
] as const;

const HOW_IT_WORKS = IMPLEMENTATION_STEPS.slice(0, 4);

const WHY_CHOOSE = [
  {
    icon: Shield,
    title: "Official Meta integration",
    description:
      "Built on the WhatsApp Business API with webhook verification, template sync, and encrypted credential storage.",
  },
  {
    icon: Users,
    title: "Built for teams",
    description:
      "Owners, admins, agents, and viewers — everyone works from one number with role-based permissions.",
  },
  {
    icon: Zap,
    title: "WhatsApp + email outreach",
    description:
      "Template broadcasts on WhatsApp, plus BYO SMTP email campaigns with lists, starter templates, and CSV import on Business and Enterprise.",
  },
  {
    icon: BarChart3,
    title: "Real-time analytics",
    description:
      "Dashboard metrics, conversation charts, pipeline donuts, response times, and cross-module activity feed.",
  },
] as const;

function HeroPreview() {
  return (
    <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
      <div
        className={`absolute -inset-4 rounded-3xl bg-gradient-to-br ${vm.gradientGlow} blur-2xl`}
      />
      <div className="relative space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_20px_60px_rgba(15,23,42,0.08)] sm:p-5">
        {/* Equal channel spotlight in the hero visual */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2.5">
            <div className="flex size-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Phone className="size-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-emerald-900">WhatsApp</p>
              <p className="truncate text-[11px] text-emerald-700/80">
                Business API · Live
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-sky-200 bg-sky-50/80 px-3 py-2.5">
            <div className="flex size-8 items-center justify-center rounded-full bg-sky-100 text-sky-700">
              <Mail className="size-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-sky-900">Email</p>
              <p className="truncate text-[11px] text-sky-700/80">
                BYO SMTP · Ready
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-teal-50 text-teal-600">
              <MessageSquare className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Shared Inbox</p>
              <p className="text-xs text-slate-500">12 open conversations</p>
            </div>
          </div>
          <Badge className="border-teal-200 bg-teal-50 text-teal-700">Live</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "WhatsApp sent", value: "1.2k", sub: "This week" },
            { label: "Email sent", value: "480", sub: "Campaigns" },
            { label: "Open deals", value: "₹4.8L", sub: "Pipeline value" },
            { label: "Automations", value: "8", sub: "Active flows" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-slate-100 bg-white px-3 py-3"
            >
              <p className="text-xs text-slate-500">{stat.label}</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{stat.value}</p>
              <p className={`text-[11px] ${vm.accent}`}>{stat.sub}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Bot className={`size-4 ${vm.accent}`} />
            <p className="text-xs font-semibold text-slate-700">Recent activity</p>
          </div>
          <div className="space-y-2">
            {[
              "New lead assigned to Priya — Inbox",
              "WhatsApp broadcast delivered to 340 contacts",
              "Email campaign sent to 120 subscribers",
              "Deal moved to Won — ₹85,000",
            ].map((line) => (
              <div
                key={line}
                className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 text-xs text-slate-600"
              >
                <span className={`size-1.5 shrink-0 rounded-full ${vm.accentDot}`} />
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HomePageContent() {
  return (
    <MarketingShell theme="light">
      {/* Hero */}
      <section className="border-b border-slate-100 bg-gradient-to-b from-teal-50/40 to-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <Badge variant="secondary" className={`mb-5 ${vm.badge}`}>
                <Sparkles className="mr-1.5 size-3.5" />
                Official {PRODUCT_NAME} — {OFFICIAL_APP_URL.replace("https://", "")}
              </Badge>

              <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-[3.25rem] lg:leading-[1.1]">
                The WhatsApp & Email CRM your{" "}
                <span className={vm.gradientText}>whole team</span> can run on
              </h1>

              <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
                {META_DESCRIPTION} Connect Meta WhatsApp and your SMTP email —
                both channels are first-class — and grow revenue from one modern
                dashboard.
              </p>

              <ul className="mt-6 space-y-2.5">
                {HERO_HIGHLIGHTS.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2.5 text-sm text-slate-700"
                  >
                    <CheckCircle2 className={`mt-0.5 size-4 shrink-0 ${vm.accent}`} />
                    {item}
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button
                  size="lg"
                  render={<Link href="/signup" />}
                  className={`h-12 px-8 text-base ${vm.btnPrimary}`}
                >
                  Start free — create account
                  <ArrowRight className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  render={<Link href="/docs/whatsapp-setup" />}
                  className={`h-12 px-6 text-base ${vm.btnOutline}`}
                >
                  <Phone className="size-4" />
                  WhatsApp
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  render={<Link href="/docs/email-marketing" />}
                  className={`h-12 px-6 text-base ${vm.btnOutline}`}
                >
                  <Mail className="size-4" />
                  Email
                </Button>
              </div>

              <p className="mt-5 text-sm text-slate-500">
                Already using {PRODUCT_NAME}?{" "}
                <Link href="/login" className={vm.link}>
                  Sign in to your dashboard
                </Link>
              </p>
            </div>

            <HeroPreview />
          </div>

          <div className="mt-14 grid grid-cols-2 gap-4 border-t border-slate-200 pt-10 sm:grid-cols-4">
            {HERO_STATS.map((stat) => (
              <div key={stat.label} className="text-center sm:text-left">
                <p className="text-2xl font-bold text-slate-900 sm:text-3xl">
                  {stat.value}
                </p>
                <p className="mt-1 text-sm text-slate-500">{stat.label}</p>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* Channels — equal highlight for WhatsApp + Email on public home */}
      <section
        id="channels"
        className="scroll-mt-24 border-b border-slate-100 bg-white"
      >
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <ChannelPair />
        </div>
      </section>

      {/* About */}
      <section id="about" className="scroll-mt-24 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid items-start gap-12 lg:grid-cols-2">
            <div>
              <p className={vm.sectionLabel}>About {PRODUCT_NAME}</p>
              <h2 className="mt-2 text-3xl font-bold text-slate-900 sm:text-4xl">
                Built by {COMPANY_NAME}
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                {PRODUCT_NAME} is a WhatsApp & Email CRM powered by the official
                Meta WhatsApp Business API and BYO SMTP email marketing (Business
                and Enterprise). Your sales, support, and marketing teams share
                one inbox, one contact database, and one automation engine —
                without juggling spreadsheets or third-party tools.
              </p>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                From the first inbound message to a closed deal, every step lives
                inside VedMint: assign conversations, tag contacts, run WhatsApp
                broadcasts, send email campaigns over your SMTP, build automations,
                and track pipeline value in real time.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <a
                      href="https://www.vedmint.com"
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                  className={vm.btnOutline}
                >
                  Visit www.vedmint.com
                  <ExternalLink className="size-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href="/discover" />}
                  className={vm.btnOutline}
                >
                  Full feature reference
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {WHY_CHOOSE.map((item) => (
                <Card
                  key={item.title}
                  className="border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
                >
                  <CardHeader className="pb-2">
                    <div
                      className={`mb-2 flex size-10 items-center justify-center rounded-xl ${vm.iconBox}`}
                    >
                      <item.icon className="size-5" />
                    </div>
                    <CardTitle className="text-base text-slate-900">
                      {item.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-slate-600">
                      {item.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section className="border-y border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className={vm.sectionLabel}>Use cases</p>
            <h2 className="mt-2 text-3xl font-bold text-slate-900 sm:text-4xl">
              One platform, every team
            </h2>
            <p className="mt-4 text-slate-600">
              Whether you sell, support, or market — VedMint adapts to how your
              business talks to customers on WhatsApp and email.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {USE_CASES.map((item) => (
              <Card
                key={item.title}
                className="border-slate-200 bg-white shadow-sm"
              >
                <CardHeader>
                  <div
                    className={`mb-3 flex size-12 items-center justify-center rounded-2xl ${item.color}`}
                  >
                    <item.icon className="size-6" />
                  </div>
                  <CardTitle className="text-xl text-slate-900">
                    {item.title}
                  </CardTitle>
                  <CardDescription className="text-base leading-relaxed text-slate-600">
                    {item.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-24 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className={vm.sectionLabel}>Features</p>
            <h2 className="mt-2 text-3xl font-bold text-slate-900 sm:text-4xl">
              {DASHBOARD_FEATURES.length} powerful modules
            </h2>
            <p className="mt-4 text-slate-600">
              Inbox, CRM, pipelines, WhatsApp broadcasts, email marketing,
              automations, flows, analytics, settings, and team management.
            </p>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {HIGHLIGHT_FEATURES.map((feature) => (
              <Card
                key={feature.id}
                className={`group border-slate-200 bg-white shadow-sm transition-all ${vm.accentBorderHover} hover:shadow-md`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={`flex size-11 items-center justify-center rounded-xl ${vm.iconBox} transition ${vm.iconBoxHover}`}
                    >
                      <FeatureIcon id={feature.id} className="size-5" />
                    </div>
                    {feature.badge ? (
                      <Badge variant="secondary" className="text-xs">
                        {feature.badge}
                      </Badge>
                    ) : null}
                  </div>
                  <CardTitle className="mt-3 text-lg text-slate-900">
                    {feature.title}
                  </CardTitle>
                  <CardDescription className="text-slate-600">
                    {feature.summary}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-slate-600">
                    {feature.capabilities.slice(0, 4).map((cap) => (
                      <li key={cap} className="flex items-start gap-2">
                        <span
                          className={`mt-2 size-1 shrink-0 rounded-full ${vm.accentDot}`}
                        />
                        {cap}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={feature.href}
                    className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-teal-600 hover:text-teal-700"
                  >
                    Open {feature.title}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Button
              variant="outline"
              render={<Link href="/discover#dashboard-features" />}
              className={vm.btnOutline}
            >
              Explore all modules & documentation
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section
        id="how-it-works"
        className="scroll-mt-24 border-t border-slate-100 bg-slate-50"
      >
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-start">
            <div>
              <p className={vm.sectionLabel}>How it works</p>
              <h2 className="mt-2 text-3xl font-bold text-slate-900 sm:text-4xl">
                Go live in four steps
              </h2>
              <p className="mt-4 text-slate-600">
                From account creation to your first conversation — set up Meta
                WhatsApp and SMTP email side by side with our guides.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  size="lg"
                  render={<Link href="/docs/whatsapp-setup" />}
                  className={vm.btnSolid}
                >
                  <Phone className="size-4" />
                  WhatsApp setup
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  render={<Link href="/docs/email-marketing" />}
                  className={vm.btnOutline}
                >
                  <Mail className="size-4" />
                  Email setup
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              {HOW_IT_WORKS.map((step, index) => (
                <div
                  key={step.title}
                  className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${vm.stepBadge}`}
                  >
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold text-slate-900">{step.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">
                      {step.body}
                    </p>
                  </div>
                </div>
              ))}
              <p className="text-center text-sm text-slate-500">
                + {IMPLEMENTATION_STEPS.length - 4} more steps in our{" "}
                <Link href="/docs/getting-started" className={vm.link}>
                  getting started guide
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Roles */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className={vm.sectionLabel}>Team & permissions</p>
            <h2 className="mt-2 text-3xl font-bold text-slate-900 sm:text-4xl">
              Role-based access for every teammate
            </h2>
            <p className="mt-4 text-slate-600">
              Invite owners, admins, agents, and viewers — each with the right
              level of access to your WhatsApp CRM.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ROLE_MATRIX.map((row) => (
              <Card key={row.role} className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg text-slate-900">{row.role}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-slate-600">
                    {row.capabilities}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Ecosystem */}
      <section id="ecosystem" className="scroll-mt-24 border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className={vm.sectionLabel}>Ecosystem</p>
            <h2 className="mt-2 text-3xl font-bold text-slate-900 sm:text-4xl">
              Discover VedMint
            </h2>
            <p className="mt-4 text-slate-600">
              {PRODUCT_NAME} is part of the VedMint platform family — explore
              our consultancy site, hospitality platform, and discovery hub.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {VEDMINT_ECOSYSTEM.map((site) => (
              <a
                key={site.id}
                href={site.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all ${vm.accentBorderHover} hover:shadow-md`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex size-11 items-center justify-center rounded-xl ${vm.iconBox} ${vm.iconBoxHover}`}
                  >
                    <Globe className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{site.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {site.url.replace("https://", "")}
                    </p>
                  </div>
                  <ExternalLink className="ml-auto size-4 shrink-0 text-slate-400 group-hover:text-teal-600" />
                </div>
                <p className={`mt-2 text-xs font-medium ${vm.accent}`}>
                  {site.tagline}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  {site.description}
                </p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Docs */}
      <section id="docs" className="scroll-mt-24 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <p className={vm.sectionLabel}>Documentation</p>
              <h2 className="mt-2 text-3xl font-bold text-slate-900 sm:text-4xl">
                Everything documented
              </h2>
              <p className="mt-4 text-slate-600">
                Step-by-step guides for Meta WhatsApp setup, email marketing
                (SMTP, lists, templates, campaigns), every dashboard module,
                team roles, and troubleshooting.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  size="lg"
                  render={<Link href="/docs/getting-started" />}
                  className={vm.btnSolid}
                >
                  <BookOpen className="size-4" />
                  Getting started
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  render={<Link href="/discover" />}
                  className={vm.btnOutline}
                >
                  Full discover page
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {DOC_PAGES.map((page) => (
                <Link
                  key={page.href}
                  href={page.href}
                  className={`flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition-all ${vm.accentBorderHover} hover:shadow-md`}
                >
                  <div>
                    <p className="font-medium text-slate-900">{page.label}</p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {page.description}
                    </p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-slate-400" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div
            className={`relative overflow-hidden rounded-3xl px-6 py-14 text-center shadow-[0_20px_60px_rgba(13,148,136,0.2)] sm:px-12 ${vm.gradientHero}`}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(20,184,166,0.25),transparent_55%)]" />
            <div className="relative mx-auto max-w-2xl">
              <h2 className="text-2xl font-bold text-white sm:text-3xl">
                Ready to run WhatsApp and Email like a pro?
              </h2>
              <p className={`mx-auto mt-3 ${vm.ctaSubtext}`}>
                Create your free account, connect Meta WhatsApp and SMTP email,
                and manage every conversation and campaign from one place.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
                <Button
                  size="lg"
                  render={<Link href="/signup" />}
                  className={`h-12 w-full bg-white px-8 text-base sm:w-auto ${vm.btnSolidText}`}
                >
                  Create free account
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  render={<Link href="/docs/whatsapp-setup" />}
                  className={`h-12 w-full px-6 text-base sm:w-auto ${vm.btnOutlineOnDark}`}
                >
                  <Phone className="size-4" />
                  WhatsApp
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  render={<Link href="/docs/email-marketing" />}
                  className={`h-12 w-full px-6 text-base sm:w-auto ${vm.btnOutlineOnDark}`}
                >
                  <Mail className="size-4" />
                  Email
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
