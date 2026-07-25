"use client";

import Link from "next/link";
import { BookOpen, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { COMPANY_NAME } from "@/lib/brand";
import {
  DocsShell,
  DocLinkButton,
  SectionHeading,
} from "@/components/docs/docs-shared";
import {
  CRON_JOBS,
  DASHBOARD_FEATURES,
  GETTING_STARTED_SECTIONS,
  IMPLEMENTATION_STEPS,
  ROLE_MATRIX,
  SETTINGS_TABS,
} from "@/lib/docs/content";

export function GettingStartedPage() {
  return (
    <DocsShell
      title="Getting Started"
      description="Follow the implementation plan, learn every dashboard module, and understand roles and settings."
      toc={GETTING_STARTED_SECTIONS}
    >
      <div className="flex flex-wrap gap-2">
        <DocLinkButton href="/docs/whatsapp-setup" label="WhatsApp Setup" />
        <DocLinkButton href="/docs/email-marketing" label="Email Marketing" />
        <DocLinkButton href="/whatsapp/config" label="WhatsApp Config" />
        <DocLinkButton href="/dashboard" label="Dashboard" />
      </div>

      <section className="space-y-4">
        <SectionHeading
          id="overview"
          title="Overview"
          description={`${COMPANY_NAME} WhatsApp Business CRM — shared inbox, contacts, pipelines, WhatsApp broadcasts, email marketing (Business+), automations, and interactive flows.`}
        />
        <Card className="border-slate-200 bg-white shadow-sm ring-slate-200">
          <CardContent className="space-y-3 pt-4 text-sm text-slate-700">
            <div className="mb-2 flex items-center gap-2">
              <BookOpen className="size-4 text-primary" />
              <Badge variant="secondary">In-app docs</Badge>
            </div>
            <p>
              Start with the implementation plan below, then configure Meta
              WhatsApp in the{" "}
              <Link href="/docs/whatsapp-setup" className="text-primary hover:underline">
                WhatsApp Setup
              </Link>{" "}
              guide. For BYO SMTP campaigns, lists, and starter templates, see{" "}
              <Link href="/docs/email-marketing" className="text-primary hover:underline">
                Email Marketing
              </Link>
              .
            </p>
            <div className="flex flex-wrap gap-2">
              {DASHBOARD_FEATURES.slice(0, 8).map((f) => (
                <DocLinkButton key={f.id} href={f.href} label={f.title} />
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeading
          id="implementation-plan"
          title="Implementation Plan"
          description={`Follow these steps in order to connect Meta WhatsApp and start using ${COMPANY_NAME}.`}
        />
        <div className="space-y-3">
          {IMPLEMENTATION_STEPS.map((step, index) => (
            <Card
              key={step.title}
              className="border-slate-200 bg-white shadow-sm ring-slate-200"
            >
              <CardHeader className="pb-2">
                <div className="flex items-start gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-700">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-slate-900">{step.title}</CardTitle>
                    <CardDescription className="mt-1 text-slate-600">
                      {step.body}
                    </CardDescription>
                    {step.links?.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {step.links.map((link) => (
                          <DocLinkButton
                            key={link.href + link.label}
                            href={link.href}
                            label={link.label}
                            external={link.external}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading
          id="auth-team"
          title="Auth & Team"
          description="Account creation, email verification, and team invitations."
        />
        <Card className="border-slate-200 bg-white shadow-sm ring-slate-200">
          <CardContent className="space-y-3 pt-4 text-sm text-slate-700">
            <ol className="list-decimal space-y-3 pl-5">
              <li>
                Sign up with name, email, and password, then verify your email
                before signing in.
              </li>
              <li>
                First user becomes account Owner. Invite teammates from the Team
                settings tab.
              </li>
              <li>
                Invite links go to{" "}
                <code className="text-primary">/join/[token]</code> — recipients
                sign up or log in, then accept the invitation.
              </li>
            </ol>
            <div className="flex flex-wrap gap-2 pt-1">
              <DocLinkButton href="/signup" label="Sign Up" />
              <DocLinkButton href="/login" label="Log In" />
              <DocLinkButton href="/team" label="Team" />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeading
          id="dashboard-features"
          title="Dashboard Features"
          description="Every module with capabilities, how to use, and a direct link."
        />
        <div className="space-y-4">
          {DASHBOARD_FEATURES.map((feature) => (
            <Card
              key={feature.id}
              id={feature.id}
              className="scroll-mt-24 border-slate-200 bg-white shadow-sm ring-slate-200"
            >
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-slate-900">{feature.title}</CardTitle>
                  {feature.badge ? (
                    <Badge variant="outline">{feature.badge}</Badge>
                  ) : null}
                </div>
                <CardDescription>{feature.summary}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Capabilities
                  </p>
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {feature.capabilities.map((cap) => (
                      <li
                        key={cap}
                        className="flex items-start gap-2 text-sm text-slate-700"
                      >
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        {cap}
                      </li>
                    ))}
                  </ul>
                </div>
                <Separator className="bg-slate-200" />
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    How to use
                  </p>
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
                    {feature.howToUse.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </div>
                {feature.roleNote ? (
                  <p className="text-xs text-slate-500">{feature.roleNote}</p>
                ) : null}
                <DocLinkButton href={feature.href} label={`Open ${feature.title}`} />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading
          id="settings"
          title="Settings Guide"
          description="What each settings tab configures and who can access it."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {SETTINGS_TABS.map((tab) => (
            <Card
              key={tab.tab}
              className="border-slate-200 bg-white shadow-sm ring-slate-200"
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-slate-900">{tab.label}</CardTitle>
                <CardDescription>{tab.description}</CardDescription>
              </CardHeader>
              <CardFooter className="flex items-center justify-between border-t border-slate-200 bg-transparent px-4 py-3">
                <span className="text-xs text-slate-500">{tab.who}</span>
                <DocLinkButton href={tab.href} label="Open" />
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading
          id="cron-jobs"
          title="Background Tasks"
          description="Automations, flows, and large broadcasts rely on periodic background processing."
        />
        <div className="space-y-3">
          {CRON_JOBS.map((job) => (
            <Card
              key={job.endpoint}
              className="border-slate-200 bg-white shadow-sm ring-slate-200"
            >
              <CardContent className="space-y-1 pt-4 text-sm">
                <p className="font-medium text-slate-900">{job.endpoint}</p>
                <p className="text-slate-600">Frequency: {job.schedule}</p>
                <p className="text-slate-700">{job.purpose}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading
          id="roles"
          title="Roles & Permissions"
          description="What each account role can do."
        />
        <Card className="border-slate-200 bg-white shadow-sm ring-slate-200">
          <CardContent className="overflow-x-auto pt-4">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2 pr-4 font-medium">Role</th>
                  <th className="pb-2 font-medium">Capabilities</th>
                </tr>
              </thead>
              <tbody>
                {ROLE_MATRIX.map((row) => (
                  <tr
                    key={row.role}
                    className="border-b border-slate-200 last:border-0"
                  >
                    <td className="py-2.5 pr-4 font-medium text-slate-900">
                      {row.role}
                    </td>
                    <td className="py-2.5 text-slate-600">{row.capabilities}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>
    </DocsShell>
  );
}
