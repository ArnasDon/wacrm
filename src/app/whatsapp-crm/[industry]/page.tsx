import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronRight, Mail, MapPin, Phone } from "lucide-react";
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
  seoPagePath,
  toCountrySlug,
} from "@/lib/seo/whatsapp-crm-pages";
import { cn } from "@/lib/utils";

type PageProps = {
  params: Promise<{ industry: string }>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return INDUSTRIES.map((i) => ({ industry: i.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { industry: industrySlug } = await params;
  const industry = INDUSTRIES.find((i) => i.slug === industrySlug);
  if (!industry) return { title: "Not found", robots: { index: false } };

  const title = `WhatsApp & Email CRM for ${industry.name} Worldwide | ${PRODUCT_NAME}`;
  const description = `Country-by-country WhatsApp Business + Email CRM guides for ${industry.name.toLowerCase()} teams. Shared inbox, SMTP campaigns, pipelines, broadcasts, and automations by ${COMPANY_NAME}.`;
  const url = `${OFFICIAL_APP_URL}/whatsapp-crm/${industry.slug}`;

  return {
    title,
    description,
    metadataBase: new URL(OFFICIAL_APP_URL),
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url,
      siteName: COMPANY_NAME,
      type: "website",
      images: [{ url: logoUrl(), width: 820, height: 304, alt: COMPANY_NAME }],
    },
  };
}

export default async function WhatsappCrmIndustryPage({ params }: PageProps) {
  const { industry: industrySlug } = await params;
  const industry = INDUSTRIES.find((i) => i.slug === industrySlug);
  if (!industry) notFound();

  const pages = getAllSeoPages().filter((p) => p.industrySlug === industry.slug);

  return (
    <MarketingShell theme="light">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
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
          <span className="font-medium text-slate-900">{industry.name}</span>
        </nav>

        <h1 className="mt-5 max-w-3xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          WhatsApp & Email CRM for {industry.name} — worldwide guides
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">
          Explore {PRODUCT_NAME} playbooks for {industry.name.toLowerCase()}{" "}
          teams across {COUNTRIES.length} countries. Built for{" "}
          {industry.angle} on WhatsApp and email.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button className={vm.btnPrimary} render={<Link href="/signup" />}>
            Get started
            <ArrowRight className="size-4" />
          </Button>
          <Button
            variant="outline"
            className={cn("rounded-xl", vm.btnOutline)}
            render={<Link href="/docs/whatsapp-setup" />}
          >
            <Phone className="size-4" />
            WhatsApp
          </Button>
          <Button
            variant="outline"
            className={cn("rounded-xl", vm.btnOutline)}
            render={<Link href="/docs/email-marketing" />}
          >
            <Mail className="size-4" />
            Email
          </Button>
          <Button
            variant="outline"
            className={vm.btnOutline}
            render={<Link href="/pricing" />}
          >
            Pricing
          </Button>
        </div>

        <section className="mt-12">
          <ChannelPair />
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold text-slate-900">
            Choose a country ({pages.length} guides)
          </h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COUNTRIES.map((country) => {
              const path = seoPagePath(industry.slug, toCountrySlug(country));
              return (
                <li key={country}>
                  <Link
                    href={path}
                    className={cn(
                      "flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm text-slate-700 transition-all hover:-translate-y-0.5 hover:border-teal-200 hover:text-teal-700 hover:shadow-md",
                    )}
                  >
                    <MapPin className="size-4 shrink-0 text-teal-600" />
                    {country}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </MarketingShell>
  );
}
