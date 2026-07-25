import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Globe2, Layers3, Mail, Phone } from "lucide-react";
import { ChannelPair } from "@/components/marketing/channel-pair";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { vm } from "@/components/marketing/marketing-theme";
import { Button } from "@/components/ui/button";
import {
  COMPANY_NAME,
  OFFICIAL_APP_URL,
  PRODUCT_NAME,
  logoUrl,
} from "@/lib/brand";
import {
  COUNTRIES,
  INDUSTRIES,
  getAllSeoPages,
  getFeaturedSeoPages,
} from "@/lib/seo/whatsapp-crm-pages";
import { cn } from "@/lib/utils";

const total = getAllSeoPages().length;

export const metadata: Metadata = {
  title: `WhatsApp & Email CRM Guides by Country & Industry — ${PRODUCT_NAME}`,
  description: `Browse ${total}+ expert WhatsApp Business + Email CRM guides for industries across ${COUNTRIES.length} countries. E-E-A-T reviewed playbooks by ${COMPANY_NAME} for shared inbox, SMTP email, pipelines, and automations.`,
  metadataBase: new URL(OFFICIAL_APP_URL),
  alternates: { canonical: `${OFFICIAL_APP_URL}/whatsapp-crm` },
  robots: { index: true, follow: true },
  keywords: [
    "whatsapp crm",
    "whatsapp business api crm",
    "whatsapp shared inbox",
    "email marketing crm",
    "smtp email campaigns",
    "vedmint crm",
    "whatsapp crm by country",
  ],
  openGraph: {
    title: `WhatsApp & Email CRM Guides — ${PRODUCT_NAME}`,
    description: `Country and industry WhatsApp + Email CRM guides with E-E-A-T signals — available worldwide.`,
    url: `${OFFICIAL_APP_URL}/whatsapp-crm`,
    siteName: COMPANY_NAME,
    type: "website",
    images: [{ url: logoUrl(), width: 820, height: 304, alt: COMPANY_NAME }],
  },
};

export default function WhatsappCrmIndexPage() {
  const featured = getFeaturedSeoPages(24);

  return (
    <MarketingShell theme="light">
      <div className="relative overflow-hidden border-b border-slate-200/80">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(20,184,166,0.12),transparent)]"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-200/80 bg-teal-50/80 px-3 py-1 text-xs font-semibold text-teal-700">
            <Globe2 className="size-3.5" />
            {total} E-E-A-T guides · {COUNTRIES.length} countries
          </div>
          <h1 className="mt-5 max-w-3xl text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl sm:leading-[1.1]">
            WhatsApp & Email CRM playbooks for every{" "}
            <span className={vm.gradientText}>country & industry</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">
            Expert, regularly reviewed guides from {COMPANY_NAME}. Learn how{" "}
            {PRODUCT_NAME} helps teams worldwide run WhatsApp Business and email
            marketing with a shared inbox, CRM, pipelines, and automations.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button className={cn("h-11 rounded-xl", vm.btnPrimary)} render={<Link href="/signup" />}>
              Get started
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
            <Button
              variant="outline"
              className={cn("h-11 rounded-xl", vm.btnOutline)}
              render={<Link href="/pricing" />}
            >
              View pricing
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <section className="mb-14">
          <ChannelPair />
        </section>

        <section>
          <div className="flex items-center gap-2">
            <Layers3 className="size-5 text-teal-600" />
            <h2 className="text-xl font-semibold text-slate-900">
              Browse by industry
            </h2>
          </div>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {INDUSTRIES.map((industry) => (
              <li key={industry.slug}>
                <Link
                  href={`/whatsapp-crm/${industry.slug}`}
                  className="block h-full rounded-2xl border border-slate-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md"
                >
                  <span className="text-sm font-semibold text-slate-900">
                    {industry.name}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                    {industry.angle}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="text-xl font-semibold text-slate-900">
            Popular country guides
          </h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((page) => (
              <li key={page.path}>
                <Link
                  href={page.path}
                  className="block rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm transition-all hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-700">
                    {page.country}
                  </span>
                  <span className="mt-1 block font-medium text-slate-900">
                    {page.industry}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="text-xl font-semibold text-slate-900">
            Countries covered
          </h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {COUNTRIES.map((country) => (
              <li key={country}>
                <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                  {country}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </MarketingShell>
  );
}
