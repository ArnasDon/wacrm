"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Mail,
  Phone,
  Sparkles,
  Wrench,
} from "lucide-react";
import { ChannelPair } from "@/components/marketing/channel-pair";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { vm } from "@/components/marketing/marketing-theme";
import { Button } from "@/components/ui/button";
import {
  CUSTOM_PLAN,
  PRICING_FAQ,
  PUBLIC_SUBSCRIPTION_PLANS,
  type PublicPlan,
} from "@/lib/marketing/public-plans";
import { PRODUCT_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

type Cycle = "monthly" | "yearly";

function FeatureRow({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3 text-[13px] leading-snug text-slate-700 sm:text-sm">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 ring-1 ring-teal-100">
        <Check className="size-3 stroke-[2.5]" aria-hidden />
      </span>
      <span>{text}</span>
    </li>
  );
}

function PlanCard({ plan, cycle }: { plan: PublicPlan; cycle: Cycle }) {
  const amount =
    cycle === "monthly" ? plan.monthlyAmount : plan.yearlyAmount;
  const period = cycle === "monthly" ? "mo" : "yr";

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col rounded-3xl border bg-white p-6 transition-all duration-300 sm:p-7",
        plan.featured
          ? "z-10 border-teal-300/80 bg-gradient-to-b from-teal-50/70 via-white to-white shadow-[0_24px_60px_-28px_rgba(13,148,136,0.45)] ring-1 ring-teal-200/60 lg:-translate-y-2 lg:scale-[1.02]"
          : "border-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:-translate-y-1 hover:border-slate-300 hover:shadow-[0_18px_40px_-28px_rgba(15,23,42,0.28)]",
      )}
    >
      {plan.featured ? (
        <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-teal-400 to-transparent" />
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            className={cn(
              "text-[11px] font-semibold uppercase tracking-[0.16em]",
              plan.featured ? "text-teal-700" : "text-slate-400",
            )}
          >
            {plan.featured ? "Most popular" : "Self-serve"}
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
            {plan.name}
          </h2>
        </div>
        {plan.featured ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm shadow-teal-600/25">
            <Sparkles className="size-3" />
            Popular
          </span>
        ) : null}
      </div>

      <p className="mt-3 min-h-[3.25rem] text-sm leading-relaxed text-slate-500">
        {plan.description}
      </p>

      <div className="mt-6 flex items-end gap-1.5 border-b border-slate-100 pb-6">
        <span className="mb-1 text-sm font-medium text-slate-400">From</span>
        <span className="text-4xl font-semibold tracking-tight text-slate-900 tabular-nums">
          <span className="mr-0.5 text-2xl font-semibold text-slate-500">
            {plan.currencySymbol}
          </span>
          {amount}
        </span>
        <span className="mb-1.5 text-sm text-slate-400">/{period}</span>
      </div>

      <ul className="mt-6 flex-1 space-y-3">
        {plan.features.map((f) => (
          <FeatureRow key={f} text={f} />
        ))}
      </ul>

      <div className="mt-8">
        <Button
          className={cn(
            "h-11 w-full rounded-xl text-sm font-semibold transition-transform duration-200 group-hover:translate-y-[-1px]",
            plan.featured ? vm.btnPrimary : cn(vm.btnOutline, "bg-slate-50"),
          )}
          render={<Link href={plan.href} />}
        >
          {plan.cta}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </article>
  );
}

export function PricingPageContent() {
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [plans, setPlans] = useState<PublicPlan[]>(PUBLIC_SUBSCRIPTION_PLANS);
  const [source, setSource] = useState<"api" | "fallback" | "loading">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/billing/public-plans", {
          credentials: "omit",
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          data?: { plans?: PublicPlan[]; source?: "api" | "fallback" };
        };
        const next = json.data?.plans;
        if (!cancelled && Array.isArray(next) && next.length > 0) {
          setPlans(next);
          setSource(json.data?.source === "api" ? "api" : "fallback");
          return;
        }
      } catch {
        // keep static fallback
      }
      if (!cancelled) {
        setPlans(PUBLIC_SUBSCRIPTION_PLANS);
        setSource("fallback");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <MarketingShell theme="light">
      <section className="relative overflow-hidden border-b border-slate-200/80">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(20,184,166,0.12),transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 top-10 size-72 rounded-full bg-slate-300/20 blur-3xl"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-teal-200/80 bg-teal-50/80 px-3 py-1 text-xs font-semibold text-teal-700">
            <Sparkles className="size-3.5" />
            Transparent subscription plans
          </div>
          <h1 className="mx-auto mt-5 max-w-3xl text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl sm:leading-[1.1]">
            Pricing that scales with your{" "}
            <span className={vm.gradientText}>WhatsApp & Email team</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Choose a {PRODUCT_NAME} plan for shared inbox, contacts, pipelines,
            WhatsApp broadcasts, and automations. Email marketing (BYO SMTP,
            lists, templates, campaigns) is a first-class channel on Business
            and Enterprise. Sign up to unlock live checkout.
          </p>

          <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 p-1 shadow-sm backdrop-blur">
            {(["monthly", "yearly"] as Cycle[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCycle(c)}
                className={cn(
                  "rounded-full px-5 py-2 text-sm font-medium transition-all",
                  cycle === c
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-800",
                )}
              >
                {c === "monthly" ? "Monthly" : "Yearly"}
              </button>
            ))}
            {cycle === "yearly" ? (
              <span className="mr-1 hidden rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-700 sm:inline">
                Best value
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-10">
          <ChannelPair />
        </div>
        <div className="grid items-stretch gap-5 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} cycle={cycle} />
          ))}
        </div>

        <article className="relative mt-8 overflow-hidden rounded-3xl border border-slate-800/10 bg-gradient-to-br from-slate-900 via-slate-900 to-teal-900 p-6 text-white shadow-[0_24px_60px_-32px_rgba(15,23,42,0.65)] sm:p-8 lg:mt-10 lg:p-10">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-teal-400/20 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-24 left-10 size-56 rounded-full bg-slate-400/10 blur-3xl"
          />

          <div className="relative grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-12">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-200">
                <Wrench className="size-3.5" />
                Tailored build
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
                {CUSTOM_PLAN.name}
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">
                {CUSTOM_PLAN.description}
              </p>
              <p className="mt-5 text-sm font-medium text-teal-200">
                Quote · scoped to your workflow
              </p>

              <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
                <Button
                  className="h-11 rounded-xl border-0 bg-teal-500 px-5 text-white hover:bg-teal-400"
                  render={<a href={`tel:+91${CUSTOM_PLAN.ctaPhone}`} />}
                >
                  <Phone className="size-4" />
                  {CUSTOM_PLAN.ctaPhone}
                </Button>
                <Button
                  variant="outline"
                  className="h-11 rounded-xl border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                  render={<a href={`mailto:${CUSTOM_PLAN.ctaEmail}`} />}
                >
                  <Mail className="size-4" />
                  {CUSTOM_PLAN.ctaEmail}
                </Button>
              </div>
            </div>

            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {CUSTOM_PLAN.features.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-3.5 py-3 text-sm text-slate-100 backdrop-blur-sm"
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-teal-400/20 text-teal-300 ring-1 ring-teal-300/30">
                    <Check className="size-3 stroke-[2.5]" aria-hidden />
                  </span>
                  <span className="leading-snug">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <p className="mt-8 text-center text-xs text-slate-500">
          {source === "api"
            ? "Prices loaded from the VedMint Subscription API. After signup, Billing applies your workspace entitlements and checkout total."
            : "Starting prices match Starter ₹499, Business ₹999, and Enterprise ₹2,999. After signup, Billing shows live VedMint plan amounts."}
        </p>
      </section>

      <section className="border-t border-slate-200 bg-slate-50/80">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Pricing FAQ
          </h2>
          <dl className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {PRICING_FAQ.map((item) => (
              <div key={item.q} className="px-5 py-5 sm:px-6">
                <dt className="text-base font-semibold text-slate-900">
                  {item.q}
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-slate-600">
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-10 flex flex-wrap gap-3">
            <Button className={vm.btnPrimary} render={<Link href="/signup" />}>
              Create account
              <ArrowRight className="size-4" />
            </Button>
            <Button
              variant="outline"
              className={vm.btnOutline}
              render={<Link href="/discover" />}
            >
              Explore features
            </Button>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
